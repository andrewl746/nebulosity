const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The host name in a Host header or an origin: "localhost:3000" → "localhost", "[::1]:3000" → "[::1]". */
function hostnameOf(hostAndPort: string): string | null {
    try{
        return new URL(`http://${hostAndPort}`).hostname;
    } catch{
        return null;
    }
}

/**
 * Whether a request is addressed to this machine by name (its Host header). Every API route checks this (proxy.ts):
 * a page whose host name was rebound to 127.0.0.1 is same-origin with itself, so only its Host gives it away.
 */
export function isLocalHost(headers: { get(name: string): string | null }): boolean {
    const host = headers.get("host");
    const hostname = host === null ? null : hostnameOf(host);
    return hostname !== null && LOCAL_HOSTNAMES.has(hostname);
}

/**
 * Whether a request comes from this machine and from no other web page (ADR-039), the guard on every route that
 * spends money, changes the index or drives the Map.
 * - **Host.** It must name this machine. A page on another site that reaches 127.0.0.1 through DNS rebinding still
 *   sends its own host name.
 * - **Origin.** A browser request from any page carries that page's Origin, which must be the Map's own page: the
 *   very host and port the request is addressed to. A page from another local port (another dev server, or the app of
 *   a repo being explored) is another web page. Programs (the MCP server's fetch, curl) send no Origin.
 */
export function isLocalRequest(headers: { get(name: string): string | null }): boolean {
    if (!isLocalHost(headers)) return false;

    const origin = headers.get("origin");
    if (origin === null) return true;
    try{
        // URL drops a default port from both sides, so "localhost:80" and "http://localhost" compare equal
        return new URL(origin).host === new URL(`http://${headers.get("host")}`).host;
    } catch{
        return false;   // "null": a sandboxed frame or a file:// page
    }
}
