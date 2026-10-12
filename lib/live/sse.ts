/** One Server-Sent Events frame (API_CONTRACTS.md §1): the event's name, its data as JSON, and a blank line. */
export function sseFrame(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A comment line: browsers ignore it, and it keeps an idle stream's socket from being closed. */
export const SSE_KEEP_ALIVE = ": keep-alive\n\n";

export const SSE_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
} as const;
