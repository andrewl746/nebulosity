import type { LiveEvent } from "../contracts";
import { readConfig } from "../config";

/**
 * Tells the open Maps about a tool call (PIVOT_SPEC.md §8): one POST to the local server, with a 200 ms timeout.
 * Every failure is swallowed, because no Map being open is the normal case. True when the server took the event.
 */
export async function postLiveEvent(
    event: LiveEvent,
    options: { port?: number; timeoutMs?: number; fetchFn?: typeof fetch } = {}
): Promise<boolean> {
    const port = options.port ?? readConfig().port;
    try{
        const response = await (options.fetchFn ?? fetch)(`http://127.0.0.1:${port}/api/live`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(options.timeoutMs ?? 200),
        });
        return response.ok;
    } catch{
        return false;
    }
}
