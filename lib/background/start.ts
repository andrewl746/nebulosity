import { fork } from "child_process";
import { readConfig } from "../config";
import { getDb } from "../db/client";
import { nebulosityHome, nebulosityPath } from "../home";
import type { ApiFailure, ChildMessage } from "./protocol";
import { createSupervisor, type ChildLike, type Supervisor } from "./supervisor";

// on globalThis so a hot reload in development keeps its one worker instead of forking another
const globalForBackground = globalThis as unknown as { nebulosityBackground?: Supervisor };

const WORKER_OFF: ApiFailure["error"] = { code: "INTERNAL", message: "This server was started with NEBULOSITY_WORKER=off, so it has no background worker." };

/** The "supervisor" of a server started only to measure (ADR-038, amended): it forks nothing and refuses what needs a worker. */
const noWorker: Supervisor = {
    setRepo(){},
    summarize: async () => ({ ok: false, error: WORKER_OFF }),
    index: async () => ({ ok: false, error: WORKER_OFF }),
    stop(){},
};

/**
 * The server's one background worker (ADR-038), started on first use. The database is opened (and migrated) here
 * first, so the worker never races the server through a new migration. With NEBULOSITY_WORKER=off there is none: the
 * routes that tell the supervisor the repo (status, repos, index, summarize) would otherwise start one on first use,
 * whatever instrumentation.ts skipped.
 */
export function backgroundSupervisor(): Supervisor {
    if (process.env.NEBULOSITY_WORKER === "off") return noWorker;
    if (!globalForBackground.nebulosityBackground){
        getDb();
        const supervisor = createSupervisor(spawnWorker);
        supervisor.setRepo(readConfig().activeRepo);
        globalForBackground.nebulosityBackground = supervisor;
    }
    return globalForBackground.nebulosityBackground;
}

/**
 * The worker, on the repo the config names now. `npm run index` can change the active repo behind the server's back,
 * and the Map follows the config on its next status poll, so every route that talks to the worker (and that poll)
 * comes through here first (ADR-038, amended). Telling the supervisor the repo it already has costs nothing.
 */
export function workerOn(root: string | null): Supervisor {
    const supervisor = backgroundSupervisor();
    supervisor.setRepo(root);
    return supervisor;
}

/** Forks scripts/background.ts through tsx, the way every CLI script runs; `--import tsx` resolves from the checkout (cwd). */
function spawnWorker(): ChildLike {
    const child = fork(nebulosityPath("scripts", "background.ts"), [], {
        cwd: nebulosityHome(),
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    const exitListeners: ((code: number | null) => void)[] = [];
    let exited = false;
    const exit = (code: number | null): void => {
        if (exited) return;
        exited = true;
        for (const listener of exitListeners) listener(code);
    };
    child.on("exit", (code) => exit(code));
    // a worker that can't start at all (tsx missing, a bad path) reports an error and may never exit: treat it as one that did
    child.on("error", (err) => {
        console.error(`[background] the worker failed: ${err.message}`);
        exit(null);
    });

    return {
        send: (message) => child.connected && child.send(message),
        onMessage: (listener) => { child.on("message", (message) => listener(message as ChildMessage)); },
        onExit: (listener) => { exitListeners.push(listener); },
        kill: () => { child.kill(); },
    };
}
