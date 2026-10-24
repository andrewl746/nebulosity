import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageLog } from "./messageLog";

type M = { kind: "a" | "b"; n: number };
const a = (n: number): M => ({ kind: "a", n });
const b = (n: number): M => ({ kind: "b", n });
const isA = (m: M): boolean => m.kind === "a";

describe("MessageLog (NebulosityApi's sent and received, Plan Review I15)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps every message in the order added", () => {
        const log = new MessageLog<M>();
        log.add(a(1));
        log.add(b(2));
        log.add(a(3));
        expect(log.all).toEqual([a(1), b(2), a(3)]);
    });

    it("waitFor gets the first match added after the call", async () => {
        const log = new MessageLog<M>();
        log.add(a(1));
        const next = log.waitFor(isA, 1_000);
        log.add(b(2));
        log.add(a(3));
        log.add(a(4));
        await expect(next).resolves.toEqual(a(3));
    });

    it("never takes a message already in the log, and gives up at timeoutMs", async () => {
        const log = new MessageLog<M>();
        log.add(a(1));
        const next = log.waitFor(isA, 1_000);
        let settled = false;
        next.then(() => { settled = true; }, () => { settled = true; });
        await vi.advanceTimersByTimeAsync(999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(next).rejects.toThrow("No matching message came in 1000 ms.");
    });

    it("a match after a wait gave up changes nothing, and a match stops the timer", async () => {
        const log = new MessageLog<M>();
        // the expectation is attached before the clock moves, so the rejection is never unhandled
        const late = expect(log.waitFor(isA, 100)).rejects.toThrow("No matching message came in 100 ms.");
        await vi.advanceTimersByTimeAsync(100);
        await late;
        log.add(a(1));                                   // no waiter is left to settle twice

        const early = log.waitFor(isA, 100);
        log.add(a(2));
        await expect(early).resolves.toEqual(a(2));
        expect(vi.getTimerCount()).toBe(0);
    });

    it("gives each waiter its own match", async () => {
        const log = new MessageLog<M>();
        const firstA = log.waitFor(isA, 1_000);
        const firstB = log.waitFor((m) => m.kind === "b", 1_000);
        const fourth = log.waitFor((m) => m.n === 4, 1_000);
        log.add(b(1));
        log.add(a(2));
        log.add(b(3));
        log.add(a(4));
        await expect(firstA).resolves.toEqual(a(2));
        await expect(firstB).resolves.toEqual(b(1));
        await expect(fourth).resolves.toEqual(a(4));
    });

    it("a predicate that throws fails its own wait, and the others still hear the message", async () => {
        const log = new MessageLog<M>();
        const broken = log.waitFor(() => {
            throw new Error("bad predicate");
        }, 1_000);
        const fine = log.waitFor(isA, 1_000);
        log.add(a(1));
        await expect(broken).rejects.toThrow("bad predicate");
        await expect(fine).resolves.toEqual(a(1));
        expect(log.all).toEqual([a(1)]);
    });
});
