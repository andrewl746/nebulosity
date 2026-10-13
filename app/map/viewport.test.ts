import { describe, expect, it } from "vitest";
import { boundsOf, initialViewport, MIN_READABLE_ZOOM } from "./viewport";

// a 1907 × 998 window's canvas, less the top bar, the breadcrumb bar and the activity bar
const CANVAS = { width: 1907, height: 878 };

describe("boundsOf", () => {
    it("spans every box, from the top-left corners to the far edges (232 × 56 boxes)", () => {
        const positions = new Map([["a", { x: -116, y: 0 }], ["b", { x: 200, y: 120 }], ["c", { x: -300, y: 240 }]]);
        // x from -300 to 200 + 232 = 432; y from 0 to 240 + 56 = 296
        expect(boundsOf(positions)).toEqual({ x: -300, y: 0, width: 732, height: 296 });
    });

    it("is empty for a level with no boxes", () => {
        expect(boundsOf(new Map())).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});

describe("initialViewport (owner: open every level at a readable size)", () => {
    it("fits a level that fits at a readable size, centred, never past 100%", () => {
        // 1000 × 500: 1907 / (1000 × 1.15) ≈ 1.66 and 878 / (500 × 1.15) ≈ 1.53, capped at 1
        // centred: x = 1907 / 2 - (0 + 500) × 1 = 453.5, y = 878 / 2 - (0 + 250) × 1 = 189
        expect(initialViewport({ x: 0, y: 0, width: 1000, height: 500 }, CANVAS)).toEqual({ x: 453.5, y: 189, zoom: 1 });
    });

    it("fits a level between the readable floor and 100% the way React Flow's fit would", () => {
        // 1600 × 900: min(1907 / 1840, 878 / 1035) = 878 / 1035 ≈ 0.848
        const view = initialViewport({ x: -800, y: 0, width: 1600, height: 900 }, CANVAS);
        expect(view.zoom).toBeCloseTo(878 / 1035, 10);
        expect(view.x).toBeCloseTo(953.5, 10);                     // the bounds are centred on x = 0
        expect(view.y).toBeCloseTo(439 - 450 * (878 / 1035), 10);
    });

    it("opens a level too big to read whole at the readable floor, from its top, centred across", () => {
        // 1000 × 2000 would fit at 878 / 2300 ≈ 0.38: names at 15 × 0.38 ≈ 5.7 px. It opens at 0.75 instead, its top
        // 64 px under the canvas's top edge, clear of the page pill: y = 64 - 0 × 0.75 = 64; x centres the bounds
        expect(initialViewport({ x: -500, y: 0, width: 1000, height: 2000 }, CANVAS)).toEqual({ x: 953.5, y: 64, zoom: MIN_READABLE_ZOOM });
    });

    it("keeps names at 11 px or more: the floor is 0.75, and 15 px names × 0.75 = 11.25 px", () => {
        expect(MIN_READABLE_ZOOM).toBe(0.75);
    });

    it("leaves an empty level (or a canvas not measured yet) at 100%", () => {
        expect(initialViewport({ x: 0, y: 0, width: 0, height: 0 }, CANVAS)).toEqual({ x: 953.5, y: 439, zoom: 1 });
        expect(initialViewport({ x: 0, y: 0, width: 500, height: 500 }, { width: 0, height: 0 }).zoom).toBe(1);
    });
});
