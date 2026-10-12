import { fork } from "child_process";
import { readConfig } from "../config";
import { getDb } from "../db/client";
import { nebulosityHome, nebulosityPath } from "../home";
import type { ChildMessage } from "./protocol";
import { createSupervisor, type ChildLike, type Supervisor } from "./supervisor";

// on globalThis so a hot reload in development keeps its one worker instead of forking another
const globalForBackground = globalThis as unknown as { nebulosityBackground?: Supervisor };

/**
 * The server's one background worker (ADR-038), started on first use. The database is opened (and migrated) here
 * first, so the worker never races the server through a new migration.
 */
export function backgroundSupervisor(): Supervisor {
    if (!globalForBackground.nebulosityBackground){
        getDb();
        const supervisor = createSupervisor(spawnWorker);
        supervisor.setRepo(readConfig().activeRepo);
        globalForBackground.nebulosityBackground = supervisor;
    }
    return globalForBackground.nebulosityBackground;
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
