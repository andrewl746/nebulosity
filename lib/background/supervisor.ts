import type { IndexEventMap } from "../contracts";
import type { ApiFailure, ChildMessage, IndexOutcome, ParentMessage, SummarizeOutcome } from "./protocol";

/** The part of a ChildProcess the supervisor uses, so tests can hand it a fake. `send` is false when nothing received it. */
export type ChildLike = {
    send(message: ParentMessage): boolean;
    onMessage(listener: (message: ChildMessage) => void): void;
    onExit(listener: (code: number | null) => void): void;
    kill(): void;
};

export type Supervisor = {
    /** Points the worker at a repo (null: none), now and after every restart; starts the worker on first use. */
    setRepo(root: string | null): void;
    summarize(targetPath: string): Promise<SummarizeOutcome>;
    index(onProgress: (progress: IndexEventMap["progress"]) => void): Promise<IndexOutcome>;
    stop(): void;
};

/** How long to wait before each restart of a worker that died: growing, so a crash loop can't spin. The last one repeats. */
export const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

const DOWN: ApiFailure["error"] = { code: "INTERNAL", message: "The background worker isn't running right now (it restarts on its own); try again in a moment." };
const GONE: ApiFailure["error"] = { code: "INTERNAL", message: "The background worker stopped before answering; try again." };

type Pending = {
    settle: (reply: ChildMessage) => void;
    fail: (error: ApiFailure["error"]) => void;
    onProgress?: (progress: IndexEventMap["progress"]) => void;
};

/**
 * The server's side of the background worker (ADR-038). It starts the worker, sends it requests and matches the answers
 * by id. When the worker dies, everything it owed is answered with an error, and a new one starts after a growing
 * delay, pointed at the same repo. While none is running, requests fail at once instead of waiting.
 */
export function createSupervisor(spawn: () => ChildLike, options: { log?: (message: string) => void } = {}): Supervisor {
    const log = options.log ?? ((message: string) => console.log(`[background] ${message}`));
    const pending = new Map<number, Pending>();
    let child: ChildLike | null = null;
    let repo: string | null = null;
    let nextId = 1;
    let crashes = 0;
    let stopped = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    const start = (): void => {
        const current = spawn();
        child = current;

        current.onMessage((message) => {
            if (message.type === "ready"){
                crashes = 0;   // it came up: the next crash starts the delays over
                return;
            }
            if (message.type === "index-progress"){
                pending.get(message.id)?.onProgress?.(message.progress);
                return;
            }
            const waiting = pending.get(message.id);
            if (!waiting) return;
            pending.delete(message.id);
            waiting.settle(message);
        });

        current.onExit((code) => {
            if (child !== current) return;
            child = null;
            // everything this worker owed is answered now, as a failure: nothing waits on a dead process
            for (const waiting of pending.values()) waiting.fail(GONE);
            pending.clear();
            if (stopped) return;

            const delay = RESTART_DELAYS_MS[Math.min(crashes, RESTART_DELAYS_MS.length - 1)];
            crashes++;
            log(`the worker stopped (exit code ${code}); starting a new one in ${delay / 1000} s`);
            restartTimer = setTimeout(() => {
                restartTimer = null;
                if (!stopped) start();
            }, delay);
        });

        current.send({ type: "repo", root: repo });
    };

    /** Registers a request and sends it: resolves with the worker's reply, or with a failure when it can't answer. */
    const ask = (build: (id: number) => ParentMessage, onProgress?: Pending["onProgress"]): Promise<ChildMessage | ApiFailure> => {
        const current = child;
        if (!current) return Promise.resolve({ ok: false, error: DOWN });

        const id = nextId++;
        return new Promise((resolve) => {
            pending.set(id, { settle: resolve, fail: (error) => resolve({ ok: false, error }), onProgress });
            if (!current.send(build(id))){
                pending.delete(id);
                resolve({ ok: false, error: DOWN });
            }
        });
    };

    return {
        setRepo(root){
            repo = root;
            if (stopped) return;
            if (child) child.send({ type: "repo", root });
            else if (restartTimer === null) start();
        },

        async summarize(targetPath){
            const reply = await ask((id) => ({ type: "summarize", id, path: targetPath }));
            if (!("type" in reply)) return reply;
            return reply.type === "summarized" ? reply.outcome : { ok: false, error: GONE };
        },

        async index(onProgress){
            const reply = await ask((id) => ({ type: "index", id }), onProgress);
            if (!("type" in reply)) return reply;
            return reply.type === "indexed" ? reply.outcome : { ok: false, error: GONE };
        },

        stop(){
            stopped = true;
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = null;
            child?.kill();
        },
    };
}
