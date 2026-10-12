import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildMessage, ParentMessage } from "./protocol";
import { createSupervisor, type ChildLike } from "./supervisor";

class FakeChild implements ChildLike {
    sent: ParentMessage[] = [];
    killed = false;
    private messageListeners: ((message: ChildMessage) => void)[] = [];
    private exitListeners: ((code: number | null) => void)[] = [];
    send(message: ParentMessage): boolean { this.sent.push(message); return true; }
    onMessage(listener: (message: ChildMessage) => void): void { this.messageListeners.push(listener); }
    onExit(listener: (code: number | null) => void): void { this.exitListeners.push(listener); }
    kill(): void { this.killed = true; }
    reply(message: ChildMessage): void { for (const listener of this.messageListeners) listener(message); }
    exit(code: number | null): void { for (const listener of this.exitListeners) listener(code); }
}

function supervised(){
    const children: FakeChild[] = [];
    const supervisor = createSupervisor(() => {
        const child = new FakeChild();
        children.push(child);
        return child;
    }, { log: () => {} });
    return { supervisor, children };
}

const summary = { path: "src/a.ts", kind: "file" as const, tagline: "A", summary: "S.", summaryStatus: "fresh" as const };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("supervisor", () => {
    it("starts the worker on the first setRepo, tells it the repo, and tells the same worker about the next one", () => {
        const { supervisor, children } = supervised();
        expect(children).toHaveLength(0);
        supervisor.setRepo("/r");
        expect(children).toHaveLength(1);
        expect(children[0].sent).toEqual([{ type: "repo", root: "/r" }]);
        supervisor.setRepo("/s");
        expect(children).toHaveLength(1);
        expect(children[0].sent.at(-1)).toEqual({ type: "repo", root: "/s" });
    });

    it("answers a summarize request with the worker's reply", async () => {
        const { supervisor, children } = supervised();
        supervisor.setRepo("/r");
        const answer = supervisor.summarize("src/a.ts");
        expect(children[0].sent.at(-1)).toEqual({ type: "summarize", id: 1, path: "src/a.ts" });
        children[0].reply({ type: "summarized", id: 1, outcome: { ok: true, summary } });
        await expect(answer).resolves.toEqual({ ok: true, summary });
    });

    it("answers what a dying worker owed with an error, and brings a new one back with the repo after 1 s", async () => {
        const { supervisor, children } = supervised();
        supervisor.setRepo("/r");
        const answer = supervisor.summarize("src/a.ts");
        children[0].exit(1);
        await expect(answer).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL" } });

        vi.advanceTimersByTime(999);
        expect(children).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(children).toHaveLength(2);
        expect(children[1].sent).toEqual([{ type: "repo", root: "/r" }]);
    });

    it("fails a request at once while no worker is running, instead of waiting", async () => {
        const { supervisor, children } = supervised();
        supervisor.setRepo("/r");
        children[0].exit(1);
        await expect(supervisor.summarize("src/a.ts")).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    });

    it("waits longer after each crash, and starts over once a worker reports ready", () => {
        const { supervisor, children } = supervised();
        supervisor.setRepo("/r");
        children[0].exit(1);
        vi.advanceTimersByTime(1_000);      // the first restart comes after 1 s
        children[1].exit(1);
        vi.advanceTimersByTime(1_999);
        expect(children).toHaveLength(2);
        vi.advanceTimersByTime(1);          // the second after 2 s
        expect(children).toHaveLength(3);
        children[2].reply({ type: "ready" });
        children[2].exit(1);
        vi.advanceTimersByTime(1_000);      // a worker that came up resets the wait
        expect(children).toHaveLength(4);
    });

    it("forwards a re-index's progress, then its result", async () => {
        const { supervisor, children } = supervised();
        supervisor.setRepo("/r");
        const progress: unknown[] = [];
        const answer = supervisor.index((p) => progress.push(p));
        const { id } = children[0].sent.at(-1) as { id: number };
        children[0].reply({ type: "index-progress", id, progress: { stage: "parse", done: 1, total: 2 } });
        const result = { files: 2, changed: 1, deleted: 0, edges: 1, folders: 1, levelEdges: 1, errors: [], skipped: 0, totalMs: 5 };
        children[0].reply({ type: "indexed", id, outcome: { ok: true, result } });
        await expect(answer).resolves.toEqual({ ok: true, result });
        expect(progress).toEqual([{ stage: "parse", done: 1, total: 2 }]);
    });

    it("stop kills the worker and never restarts it", () => {
        const { supervisor, children } = supervised();
        supervisor.setRepo("/r");
        supervisor.stop();
        expect(children[0].killed).toBe(true);
        children[0].exit(null);
        vi.advanceTimersByTime(60_000);
        expect(children).toHaveLength(1);
    });
});
