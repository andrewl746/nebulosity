import { describe, expect, it } from "vitest";
import { ECHO_MS, FOLLOW_DEBOUNCE_MS, FollowGate } from "./followGate";

/** A gate on a clock the test sets. */
function gate(){
    let t = 0;
    const g = new FollowGate(() => t);
    return { g, at: (ms: number) => { t = ms; } };
}

describe("FollowGate (P16)", () => {
    it("has the design's numbers", () => {
        expect(FOLLOW_DEBOUNCE_MS).toBe(150);
        expect(ECHO_MS).toBe(2_000);
    });

    it("a file opened from the Map doesn't echo", () => {
        const { g, at } = gate();
        at(0);
        g.opened("a.ts");
        g.mapShows("b.ts");                    // the Map moved on
        at(100);
        expect(g.shouldFollow("a.ts")).toBe(false);
        at(2_100);
        expect(g.shouldFollow("a.ts")).toBe(true);
    });

    it("the path the Map already shows isn't followed", () => {
        const { g } = gate();
        g.mapShows("c.ts");
        expect(g.shouldFollow("c.ts")).toBe(false);
        expect(g.shouldFollow("d.ts")).toBe(true);
        expect(g.shouldFollow("d.ts")).toBe(false);
    });

    it("a switch back after a pick on the Map follows", () => {
        const { g, at } = gate();
        at(0);
        expect(g.shouldFollow("log.ts")).toBe(true);
        at(10);
        g.opened("main.ts");
        at(200);
        expect(g.shouldFollow("main.ts")).toBe(false);
        at(400);
        expect(g.shouldFollow("log.ts")).toBe(true);
    });

    it("follows each switch between files", () => {
        const { g } = gate();
        expect([g.shouldFollow("b.ts"), g.shouldFollow("c.ts"), g.shouldFollow("b.ts")]).toEqual([true, true, true]);
    });

    it("reset forgets what the Map shows, not the echo", () => {
        const first = gate();
        expect(first.g.shouldFollow("a.ts")).toBe(true);
        first.g.reset();
        expect(first.g.shouldFollow("a.ts")).toBe(true);

        const { g, at } = gate();
        at(0);
        g.opened("e.ts");
        g.reset();
        at(100);
        expect(g.shouldFollow("e.ts")).toBe(false);
    });
});
