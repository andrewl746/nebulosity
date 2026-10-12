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
 * Whether a request comes from this machine and from no other web page (ADR-039), the guard on every route that
 * spends money, changes the index or drives the Map.
 * - **Host.** It must name this machine. A page on another site that reaches 127.0.0.1 through DNS rebinding still
 *   sends its own host name.
 * - **Origin.** A browser request from any page carries that page's Origin, which must be this machine as well.
 *   Programs (the MCP server's fetch, curl) send none.
 */
export function isLocalRequest(headers: { get(name: string): string | null }): boolean {
    const host = headers.get("host");
    const hostname = host === null ? null : hostnameOf(host);
    if (hostname === null || !LOCAL_HOSTNAMES.has(hostname)) return false;

    const origin = headers.get("origin");
    if (origin === null) return true;
    try{
        return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
    } catch{
        return false;   // "null": a sandboxed frame or a file:// page
    }
}
