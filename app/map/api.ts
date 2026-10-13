import type {
    DescribeResponse, ErrorCode, ErrorEnvelope, IndexEventMap, IndexStatus, LevelResponse, RepoList, SearchResult, SourceResponse,
    SummarizeResponse,
} from "@/lib/contracts";

/**
 * The Map's one door to the server (ARCHITECTURE.md §3, rule 3). Every request goes through here, so a desktop build,
 * or V1.5's static demo, swaps the transport in this one file.
 */

/** A request that failed: the server's error code, or NETWORK when no answer came back at all. */
export class ApiError extends Error {
    constructor(readonly status: number, readonly code: ErrorCode | "NETWORK", message: string){
        super(message);
        this.name = "ApiError";
    }
}

async function failure(response: Response): Promise<ApiError> {
    const body = (await response.json().catch(() => null)) as ErrorEnvelope | null;
    return new ApiError(response.status, body?.error.code ?? "INTERNAL", body?.error.message ?? `HTTP ${response.status}`);
}

async function send(url: string, init?: RequestInit): Promise<Response> {
    try{
        return await fetch(url, init);
    } catch (err){
        if (err instanceof DOMException && err.name === "AbortError") throw err;   // the caller cancelled: not a failure
        throw new ApiError(0, "NETWORK", "The Nebulosity server didn't answer. Is npm run dev still running?");
    }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await send(url, init);
    if (!response.ok) throw await failure(response);
    return (await response.json()) as T;
}

/**
 * Paths go in query strings percent-encoded, so spaces, #, %, + and non-ASCII names survive the trip. `focus` asks for
 * the page holding that path instead (API_CONTRACTS.md §11).
 */
export const levelUrl = (folderPath: string, page: number = 0, focus?: string): string =>
    `/api/level?path=${encodeURIComponent(folderPath)}${page > 0 ? `&page=${page}` : ""}${focus !== undefined ? `&focus=${encodeURIComponent(focus)}` : ""}`;
export const describeUrl = (targetPath: string): string => `/api/describe?path=${encodeURIComponent(targetPath)}`;

export type SseFrame = { event: string; data: string };

/**
 * Splits Server-Sent Events text into whole frames (API_CONTRACTS.md §1). A frame cut off at the end of a chunk comes
 * back as `rest`, to go in front of the next chunk. Comment lines (": keep-alive") are skipped.
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
    const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
    const rest = parts.pop() ?? "";
    const frames: SseFrame[] = [];

    for (const part of parts){
        let event = "message";
        const data: string[] = [];
        for (const line of part.split("\n")){
            if (line.startsWith(":")) continue;
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length > 0) frames.push({ event, data: data.join("\n") });
    }

    return { frames, rest };
}

/** Reads an SSE response body to its end, handing each whole frame to `onFrame`. A POST stream can't use EventSource. */
export async function readSseStream(body: ReadableStream<Uint8Array>, onFrame: (frame: SseFrame) => void): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;){
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) onFrame(frame);
    }
}

export const api = {
    level: (folderPath: string, page: number = 0, signal?: AbortSignal, focus?: string) =>
        request<LevelResponse>(levelUrl(folderPath, page, focus), { signal }),
    describe: (targetPath: string, signal?: AbortSignal) => request<DescribeResponse>(describeUrl(targetPath), { signal }),
    search: (query: string, limit: number, signal?: AbortSignal) =>
        request<SearchResult>(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal }),
    status: (signal?: AbortSignal) => request<IndexStatus>("/api/status", { signal }),
    source: (filePath: string, signal?: AbortSignal) => request<SourceResponse>(`/api/source?path=${encodeURIComponent(filePath)}`, { signal }),
    summarize: (targetPath: string) => request<SummarizeResponse>(`/api/summarize?path=${encodeURIComponent(targetPath)}`, { method: "POST" }),
    repos: () => request<RepoList>("/api/repos"),
    setActiveRepo: (root: string) => request<RepoList>("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root }),
    }),

    /** POST /api/index: a full structure run. Its progress goes to `onProgress`, and the `done` event is the result. */
    async reindex(onProgress: (progress: IndexEventMap["progress"]) => void): Promise<IndexEventMap["done"]> {
        const response = await send("/api/index", { method: "POST" });
        if (!response.ok || !response.body) throw await failure(response);

        const outcome: { done: IndexEventMap["done"] | null; error: IndexEventMap["error"] | null } = { done: null, error: null };
        await readSseStream(response.body, (frame) => {
            if (frame.event === "progress") onProgress(JSON.parse(frame.data) as IndexEventMap["progress"]);
            else if (frame.event === "done") outcome.done = JSON.parse(frame.data) as IndexEventMap["done"];
            else if (frame.event === "error") outcome.error = JSON.parse(frame.data) as IndexEventMap["error"];
        });
        if (outcome.error) throw new ApiError(500, outcome.error.code, outcome.error.message);
        if (!outcome.done) throw new ApiError(500, "INTERNAL", "The re-index ended without a result.");
        return outcome.done;
    },
};
