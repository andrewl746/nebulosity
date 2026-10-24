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

/** The Map's address for a path (`/api/repos`), at the loopback address its server listens on. */
export function mapUrl(port: number, path: string): string {
    return `http://127.0.0.1:${port}${path}`;
}

/** Whether a fetch failed because the connection was refused: undici puts the socket's code on the error's cause. */
function isRefused(err: unknown): boolean {
    const cause: unknown = err instanceof Error ? err.cause : undefined;
    return typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "ECONNREFUSED";
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
