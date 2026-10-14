import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here forks a process or opens the database: the fork is a fake, and the two modules that would reach the disk are stubs.
const fork = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ fork }));
vi.mock("../db/client", () => ({ getDb: vi.fn() }));
vi.mock("../config", () => ({ readConfig: () => ({ activeRepo: null }) }));

/** The part of a ChildProcess lib/background/start.ts touches. */
const fakeChild = () => ({ on: vi.fn(), send: vi.fn(() => true), connected: true, kill: vi.fn() });

beforeEach(() => {
    fork.mockReset();
    fork.mockImplementation(fakeChild);
    vi.resetModules();   // a fresh lib/background/start.ts
});
afterEach(() => {
    vi.unstubAllEnvs();
    // the supervisor is kept on globalThis across hot reloads, which here would carry one test's into the next
    delete (globalThis as { nebulosityBackground?: unknown }).nebulosityBackground;
});

describe("the server's worker, with NEBULOSITY_WORKER=off (ADR-038, amended)", () => {
    it("forks no worker when a route tells it the repo", async () => {
        // /api/status does this on every poll, so instrumentation.ts skipping the worker at start is not enough
        vi.stubEnv("NEBULOSITY_WORKER", "off");
        const { workerOn } = await import("./start");
        workerOn("C:/repo");
        expect(fork).not.toHaveBeenCalled();
    });

    it("answers the requests that need a worker with a plain refusal instead of forking one", async () => {
        vi.stubEnv("NEBULOSITY_WORKER", "off");
        const { workerOn } = await import("./start");
        const supervisor = workerOn("C:/repo");
        const summarized = await supervisor.summarize("src", "C:/repo");
        const indexed = await supervisor.index(() => {}, "C:/repo");

        for (const outcome of [summarized, indexed]){
            expect(outcome.ok).toBe(false);
            if (!outcome.ok) expect(outcome.error.message).toContain("NEBULOSITY_WORKER=off");
        }
        expect(fork).not.toHaveBeenCalled();
    });

    it("still forks the worker when the variable is unset", async () => {
        vi.stubEnv("NEBULOSITY_WORKER", undefined);
        const { workerOn } = await import("./start");
        workerOn("C:/repo");
        expect(fork).toHaveBeenCalledTimes(1);
    });
});
