/**
 * The extension's own requests to the Map (design §4.1): Node's fetch from the extension host to
 * `http://127.0.0.1:<port>`, which sends no Origin and a Host naming this machine, so ADR-039's guards pass with no
 * change. Every request has a timeout. A connection refused (nothing listens on the port) is its own error, which callers
 * tell apart from a timeout: it's how "not running" (the start poll) and "the Map stopped" (P18) are told.
 */

/** Nothing listens on the port. */
export class RefusedError extends Error {
    constructor(readonly port: number){
        super(`Nothing is listening on port ${port}.`);
        this.name = "RefusedError";
    }
}

/** The port answered nothing in time. */
export class TimeoutError extends Error {
    constructor(readonly url: string, readonly timeoutMs: number){
        super(`${url} didn't answer in ${timeoutMs} ms.`);
        this.name = "TimeoutError";
    }
}

/** A status and the body read as JSON, or the body's text when it isn't JSON (another app's HTML page, say). */
export type HttpAnswer = { status: number; body: unknown };

/** The error envelope's message (API_CONTRACTS §1), or the status when the body isn't one. */
export function errorText(status: number, body: unknown): string {
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof message === "string" ? message : `HTTP ${status}`;
}

/** The Map's address for a path (`/api/repos`), at the loopback address its server listens on. */
export function mapUrl(port: number, path: string): string {
    return `http://127.0.0.1:${port}${path}`;
}

/** The socket's code that undici puts on a failed fetch's cause, or undefined. */
function causeCode(err: unknown): unknown {
    const cause: unknown = err instanceof Error ? err.cause : undefined;
    return typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
}

/** Whether a fetch failed because the connection was refused. */
function isRefused(err: unknown): boolean {
    return causeCode(err) === "ECONNREFUSED";
}

/**
 * Whether a fetch failed because the connection dropped once it was made: a reset (ECONNRESET), a write to a closed
 * socket (EPIPE), or one of undici's own socket errors (UND_ERR_…, "other side closed" among them). fetch rejects with
 * a TypeError whose cause carries the code, and request() passes it on as it is. A Next server coming up can drop a
 * connection it took, so the start poll reads these as "not answering yet" (mapServer.ts); anywhere else they stay
 * failures.
 */
export function isDroppedConnection(err: unknown): boolean {
    if (!(err instanceof TypeError)) return false;
    const code = causeCode(err);
    return typeof code === "string" && (code === "ECONNRESET" || code === "EPIPE" || code.startsWith("UND_ERR"));
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<HttpAnswer> {
    let response: Response;
    let text: string;
    try{
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        text = await response.text();
    } catch (err){
        if (isRefused(err)) throw new RefusedError(Number(new URL(url).port));
        if (err instanceof Error && err.name === "TimeoutError") throw new TimeoutError(url, timeoutMs);
        throw err;
    }
    let body: unknown = text;
    try{
        body = JSON.parse(text);
    } catch{
        // not JSON: the text stands for the body, and classifyRepos calls it another app
    }
    return { status: response.status, body };
}

export function getJson(url: string, timeoutMs: number): Promise<HttpAnswer> {
    return request(url, { method: "GET" }, timeoutMs);
}

export function postJson(url: string, body: unknown, timeoutMs: number): Promise<HttpAnswer> {
    return request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
}
