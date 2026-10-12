import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../contracts";
import { MAX_EVENTS_PER_SECOND, publish, subscribe } from "./hub";

const event = (tool: string): LiveEvent => ({ tool, paths: ["src/a.ts"], at: "2026-10-12T00:00:00.000Z" });

describe("live hub", () => {
    it("hands each event to every subscriber, until it unsubscribes", () => {
        const seen: string[] = [];
        const stop = subscribe((e) => seen.push(e.tool));
        expect(publish(event("describe"), 1_000_000)).toBe(true);
        stop();
        publish(event("search"), 2_000_000);
        expect(seen).toEqual(["describe"]);
    });

    it("drops events past 20 a second, and passes them again a second later", () => {
        const seen: string[] = [];
        const stop = subscribe((e) => seen.push(e.tool));
        const t = 10_000_000;
        for (let i = 0; i < MAX_EVENTS_PER_SECOND; i++) expect(publish(event(`t${i}`), t)).toBe(true);
        expect(publish(event("one too many"), t + 500)).toBe(false);
        expect(publish(event("later"), t + 1_000)).toBe(true);
        stop();
        expect(seen).toHaveLength(MAX_EVENTS_PER_SECOND + 1);
        expect(seen.at(-1)).toBe("later");
    });

    it("drops a subscriber that throws (a closed stream), and the others still get the event", () => {
        const seen: string[] = [];
        subscribe(() => { throw new Error("stream closed"); });
        const stop = subscribe((e) => seen.push(e.tool));
        publish(event("describe"), 20_000_000);
        publish(event("search"), 30_000_000);
        stop();
        expect(seen).toEqual(["describe", "search"]);
    });
});
