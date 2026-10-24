import { describe, expect, it } from "vitest";
import { ASKED_MS, ECHO_MS, FOLLOW_DEBOUNCE_MS, FollowGate } from "./followGate";

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

    it("keeps an ask for 2 s: room for a cold draw of another folder", () => {
        expect(ASKED_MS).toBe(2_000);
    });

    it("the newest editor wins over a late drawn: A, B, A with B's drawn after A's follow (Task 8 Review M2)", () => {
        const { g, at } = gate();
        at(0);
        expect(g.shouldFollow("a.ts")).toBe(true);
        at(200);
        expect(g.shouldFollow("b.ts")).toBe(true);
        at(300);
        g.mapShows("a.ts");                       // A's drawn lands after B's follow went out
        at(400);
        expect(g.shouldFollow("a.ts")).toBe(true);   // the switch back to A still follows
        at(500);
        g.mapShows("b.ts");                       // B's drawn lands after A's follow went out
        at(600);
        expect(g.shouldFollow("a.ts")).toBe(false);  // A is still what the Map was asked for
        expect(g.shouldFollow("b.ts")).toBe(true);   // and B isn't taken for what it shows
    });

    it("once a follow is ASKED_MS old, what the Map says it shows rules again", () => {
        const { g, at } = gate();
        at(0);
        expect(g.shouldFollow("a.ts")).toBe(true);
        at(100);
        g.mapShows("z.ts");                       // the Map went elsewhere (Claude's focus, or A isn't indexed)
        at(1_999);
        expect(g.shouldFollow("a.ts")).toBe(false);
        at(2_000);
        expect(g.shouldFollow("a.ts")).toBe(true);
    });

    it("a show counts as asked, like a follow", () => {
        const { g, at } = gate();
        at(0);
        g.posted("s.ts");
        at(100);
        g.mapShows("old.ts");                     // a drawn from before the show
        expect(g.shouldFollow("s.ts")).toBe(false);
        expect(g.shouldFollow("old.ts")).toBe(true);
    });

    it("a pick on the Map is newer than anything asked", () => {
        const { g, at } = gate();
        at(0);
        expect(g.shouldFollow("a.ts")).toBe(true);
        at(100);
        g.opened("m.ts");
        at(300);
        // inside ASKED_MS of a.ts' follow, but the Map shows m.ts now: a switch back to a.ts follows
        expect(g.shouldFollow("a.ts")).toBe(true);
    });

    it("What depends' pick: the importer opened is an echo, and the Map still shows the target (Task 8 Review M1)", () => {
        const { g, at } = gate();
        at(0);
        g.posted("t.ts");                         // What depends' show
        at(100);
        g.opened("b.ts", "t.ts");                 // Enter on the importer b.ts
        at(200);
        expect(g.shouldFollow("b.ts")).toBe(false);  // its editor change is an echo
        at(2_200);
        // Escape, then a click into b.ts' editor later: the Map shows t.ts, so it follows
        expect(g.shouldFollow("t.ts")).toBe(false);
        expect(g.shouldFollow("b.ts")).toBe(true);
    });
});
