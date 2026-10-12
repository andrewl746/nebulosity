import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
    it("keeps results in input order and never runs more than the limit at once", async () => {
        let running = 0;
        let peak = 0;
        const results = await mapLimit([30, 10, 20, 0, 5], 2, async (ms) => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, ms));
            running--;
            return ms * 2;
        });
        expect(results).toEqual([60, 20, 40, 0, 10]);
        expect(peak).toBe(2);
    });

    it("returns an empty list for no items", async () => {
        expect(await mapLimit([], 4, async (x: number) => x)).toEqual([]);
    });
});
