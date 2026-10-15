import { describe, expect, it } from "vitest";
import { bootstrapMedianInterval, median, mulberry32, quantile, ratioOfMedians, ratioOfPlainMedians } from "./stats";

describe("stats", () => {
    it("takes medians, the mean of the middle two for an even count, infinity included", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([1, Infinity])).toBe(Infinity);
        expect(median([5, Infinity, Infinity])).toBe(Infinity);
    });

    it("rates a question N ÷ A, a run that never reached counting as infinitely late (D2)", () => {
        expect(ratioOfMedians([10, 20, 30], [5, 5, 5])).toBe(0.25);
        expect(ratioOfMedians([null, null, 10], [1, 1, 1])).toBe(0);           // A's median never reached
        expect(ratioOfMedians([1, 1, 1], [null, null, 1])).toBe(Infinity);     // N's never reached
        expect(ratioOfMedians([null, null, null], [null, null, 1])).toBe(1);   // neither
        expect(ratioOfPlainMedians([0.10, 0.30, 0.20], [0.05, 0.05, 0.10])).toBe(0.25);
    });

    it("interpolates quantiles between order statistics, and keeps an infinite one", () => {
        expect(quantile([0, 10], 0.25)).toBe(2.5);
        expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
        expect(quantile([1, Infinity], 0.975)).toBe(Infinity);
        expect(quantile([Infinity, Infinity], 0.5)).toBe(Infinity);
    });

    it("draws the same numbers for the same seed, each in [0, 1)", () => {
        const a = mulberry32(1), b = mulberry32(1), c = mulberry32(2);
        const xs = Array.from({ length: 5 }, () => a());
        expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
        expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
        expect(c()).not.toBe(xs[0]);
    });

    it("bootstraps the median's 95% interval over questions", () => {
        expect(bootstrapMedianInterval([0.3, 0.3, 0.3])).toEqual([0.3, 0.3]);
        // two values: a resample's median is 0, 0.5 or 1, each of 0 and 1 about a quarter of 10,000 draws, so the 2.5% and
        // 97.5% points sit inside those quarters
        expect(bootstrapMedianInterval([0, 1])).toEqual([0, 1]);
    });
});
