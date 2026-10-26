/**
 * The background worker (ADR-038). The Map's server forks this file through tsx; don't run it by hand. It owns every
 * write while the Map is open: the file watcher, incremental structure updates, summary refreshes, the folder sweep and
 * embeddings. It answers the server over the IPC channel (lib/background/protocol.ts) and exits when the server goes away.
 */
import { handleParentMessage } from "../lib/background/child";
import type { ChildMessage, ParentMessage } from "../lib/background/protocol";
import { createBackgroundService, type BackgroundService } from "../lib/background/service";
import { prepareLanguages } from "../lib/index/languages/registry";
import { summarizerFromEnv } from "../lib/index/summarize/claude";
import { loadLocalEnv } from "./env";

loadLocalEnv();

const send = process.send?.bind(process);
if (!send){
    console.error("[background] this is the Map server's worker: start it with nebulosity map (in a checkout: npm run dev), not by hand");
    process.exit(1);
}

// The tree-sitter grammars load first, asynchronously (ADR-065): every update and full run after that is synchronous.
// The script is CommonJS, so no top-level await: the service is a promise, and every message waits for it, in order.
const ready: Promise<BackgroundService> = (async () => {
    await prepareLanguages();
    return createBackgroundService({
        summarizer: summarizerFromEnv(),
        log: (message) => console.log(`[background] ${message}`),
    });
})();
ready.catch((err: unknown) => {
    console.error("[background] the tree-sitter grammars failed to load:", err);
    process.exit(1);
});

process.on("message", (message: unknown) => {
    ready.then((service) => handleParentMessage(service, message as ParentMessage, (reply: ChildMessage) => { send(reply); }))
        .catch((err: unknown) => console.error("[background]", err));
});

// the server is gone (stopped, crashed, restarted): stop watching and exit, so no orphan keeps writing
process.on("disconnect", () => {
    void ready.then((service) => service.stop()).finally(() => process.exit(0));
});
