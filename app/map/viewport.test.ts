import { describe, expect, it } from "vitest";
import { boundsOf, drawnLinesBounds, fitViewport, initialViewport, linesBounds, MIN_READABLE_ZOOM, SIDE_ROOM } from "./viewport";

// a 1907 × 998 window's canvas, less the top bar, the breadcrumb bar and the activity bar
const CANVAS = { width: 1907, height: 878 };
const panel = { width: 700, height: 758 };   // VS Code's panel at 700 x 900, less its bars (shell.ts)
const laptop = { width: 904, height: 754 };  // 1440 x 900, less the explorer, inspector and bars

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

    it("opens a level too big to read whole as wide as the canvas allows, from its top, centred across", () => {
        // VS Code's contrib, page 2, on a 1907 px screen: 2,136 wide, here 1,500 tall. Whole, it would fit at
        // min(1907 / 2456.4, 878 / 1725) ≈ 0.51. Instead it fills the width less 72 px each side:
        // (1907 - 144) / 2136 = 1763 / 2136 ≈ 0.825, the owner's pick (sheet 1, B); its top 64 px under the canvas's
        // top edge, clear of the page pill: y = 64 - 0 × zoom = 64; the bounds are centred on x = 0, so x = 953.5
        const view = initialViewport({ x: -1068, y: 0, width: 2136, height: 1500 }, CANVAS);
        expect(view.zoom).toBeCloseTo(1763 / 2136, 10);
        expect(view.x).toBeCloseTo(953.5, 10);
        expect(view.y).toBe(64);
    });

    it("opens a tall, narrow level at 100%, not larger", () => {
        // 1000 × 2000: (1907 - 144) / 1000 ≈ 1.76, capped at 1; x = 953.5 - 0 × 1, y = 64 - 0 × 1
        expect(initialViewport({ x: -500, y: 0, width: 1000, height: 2000 }, CANVAS)).toEqual({ x: 953.5, y: 64, zoom: 1 });
    });

    it("never opens a level smaller than the readable floor, even one wider than the canvas", () => {
        // 2600 × 2000: (1907 - 144) / 2600 ≈ 0.68, raised to 0.75; the sides then run off the canvas, as before
        expect(initialViewport({ x: -1300, y: 0, width: 2600, height: 2000 }, CANVAS)).toEqual({ x: 953.5, y: 64, zoom: MIN_READABLE_ZOOM });
    });

    it("leaves 72 px of room each side of a level that fills the width", () => {
        expect(SIDE_ROOM).toBe(72);
    });

    it("keeps names at 11 px or more: the floor is 0.75, and 15 px names × 0.75 = 11.25 px", () => {
        expect(MIN_READABLE_ZOOM).toBe(0.75);
    });

    it("leaves an empty level (or a canvas not measured yet) at 100%", () => {
        expect(initialViewport({ x: 0, y: 0, width: 0, height: 0 }, CANVAS)).toEqual({ x: 953.5, y: 439, zoom: 1 });
        expect(initialViewport({ x: 0, y: 0, width: 500, height: 500 }, { width: 0, height: 0 }).zoom).toBe(1);
    });

    it("on a paged level, fits below the page pill's band, so no box opens under the pill (deferred minor)", () => {
        // 1000 × 500 fits at 1 either way; with 64 px reserved on top it's centred in the 814 px below them:
        // y = 64 + 814 / 2 - 250 × 1 = 221 (not 189)
        expect(initialViewport({ x: -500, y: 0, width: 1000, height: 500 }, CANVAS, 64)).toEqual({ x: 953.5, y: 221, zoom: 1 });
        // 1600 × 900: the band leaves 814 px, so it fits at 814 / 1035 ≈ 0.786 (not 0.848), centred below the band
        const view = initialViewport({ x: -800, y: 0, width: 1600, height: 900 }, CANVAS, 64);
        expect(view.zoom).toBeCloseTo(814 / 1035, 10);
        expect(view.x).toBeCloseTo(953.5, 10);
        expect(view.y).toBeCloseTo(64 + 407 - 450 * (814 / 1035), 10);
    });

    it("on a paged level, opens from the top when the band leaves too little room to fit it readably", () => {
        // 1000 × 1000: 878 / 1150 ≈ 0.76 would fit without the band; with it, 814 / 1150 ≈ 0.71 is under the floor, so
        // it fills the width ((1907 - 144) / 1000, capped at 1) from 64 px down
        expect(initialViewport({ x: -500, y: 0, width: 1000, height: 1000 }, CANVAS, 64)).toEqual({ x: 953.5, y: 64, zoom: 1 });
    });
});

it("reaches a line's extent past its corners by half its width, and its head's half-width at its tip", () => {
    expect(linesBounds([{ points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], width: 2, headHalf: 4.5 }])).toEqual({ x: -4.5, y: -1, width: 9, height: 102 });
    expect(linesBounds([])).toBeNull();
});

it("measures the drawn lines as MapCanvas draws them, each under its box's one head", () => {
    // max 4 imports: a -> b is 6 px, c -> b 1 px, and b's head is sized for 6, half max(4.5, 0.9 x 6 + 3) = 8.4. Only
    // c -> b is drawn: x -0.5..0.5 and y -0.5..100.5 for the line, -8.4..8.4 at its tip for the head (its own would be 4.5)
    const edges = [{ source: "a", target: "b", count: 4 }, { source: "c", target: "b", count: 1 }];
    const b = drawnLinesBounds(new Map([["c->b", [{ x: 0, y: 0 }, { x: 0, y: 100 }]]]), edges)!;
    expect(b.x).toBeCloseTo(-8.4, 10);
    expect(b.width).toBeCloseTo(16.8, 10);
    expect(b.y).toBe(-0.5);
    expect(b.height).toBe(101);
    expect(drawnLinesBounds(new Map(), edges)).toBeNull();
});

describe("fitViewport (the owner, 2026-10-28: Fit frames the lines too, the boxes win)", () => {
    it("fits the boxes as React Flow's fit does when there are no lines", () => {
        // 232 x 56 grown by 7.5% each side is 266.8 x 64.4: past 100%, so 1, centred on (116, 28)
        expect(fitViewport({ x: 0, y: 0, width: 232, height: 56 }, null, panel)).toEqual({ x: 234, y: 351, zoom: 1 });
    });
    it("frames lines that reach past the boxes", () => {
        // the boxes grown by 7.5% are -915.4..915.4 by -40.2..576.2, fit 700 / 1830.8 = 0.38235. The lines grown by 16
        // are -1016..1016 by -46..586, 2032 x 632: 700 / 2032 = 0.34449, 0.901 of the boxes' fit, over 0.85. Centred on
        // (0, 270): y = 379 - 270 x 0.34449
        const v = fitViewport({ x: -796, y: 0, width: 1592, height: 536 }, { x: -1000, y: -30, width: 2000, height: 600 }, panel);
        expect(v.zoom).toBeCloseTo(0.344488, 5);
        expect(v.x).toBeCloseTo(350, 5);
        expect(v.y).toBeCloseTo(285.988, 3);
    });
    it("frames the boxes alone when the lines would shrink them under 85% of their fit", () => {
        // the lines grown are 2632 wide: 700 / 2632 = 0.26596, 0.696 of 0.38235. The boxes' own fit, centred on (0, 268)
        const v = fitViewport({ x: -796, y: 0, width: 1592, height: 536 }, { x: -1300, y: -30, width: 2600, height: 600 }, panel);
        expect(v.zoom).toBeCloseTo(0.382347, 5);
        expect(v.y).toBeCloseTo(276.531, 3);
    });
});

describe("initialViewport with lines", () => {
    it("shifts a fitted page to show lanes on one side, at the same zoom", () => {
        // boxes 504 x 176 fit at 1. The lines grown by 16 reach to -76 on the left, so what's framed is -76..541.8 by
        // -16..192, its middle (232.9, 88): x = 350 - 232.9, against 350 - 252 = 98 for the boxes alone
        expect(initialViewport({ x: 0, y: 0, width: 504, height: 176 }, panel, 0, { x: -60, y: 0, width: 300, height: 176 })).toEqual({ x: 117.1, y: 291, zoom: 1 });
    });
    it("keeps the boxes' view when framing the lines would take a fitted page under 0.75", () => {
        // boxes 800 wide fit at 700 / 920 = 0.76087. With the lines, 976 wide: 0.7172, under the floor
        const v = initialViewport({ x: 0, y: 0, width: 800, height: 176 }, panel, 0, { x: -100, y: 0, width: 900, height: 176 });
        expect(v.zoom).toBeCloseTo(0.760870, 5);
        expect(v.x).toBeCloseTo(45.652, 3);
    });
    it("opens a page too big to fit wide enough for its lines across, centred on them", () => {
        // 504 x 2000 boxes open from the top at 1 (760 / 504 is over 1). Boxes and lines across are -600..252, 852 wide:
        // 760 / 852 = 0.89202, over 0.85. Centred across on -174
        const v = initialViewport({ x: -252, y: 0, width: 504, height: 2000 }, laptop, 0, { x: -600, y: 0, width: 850, height: 2000 });
        expect(v.zoom).toBeCloseTo(0.892019, 5);
        expect(v.x).toBeCloseTo(607.211, 3);
        expect(v.y).toBe(64);
    });
    it("opens it as today when its lines across would take it under 85% of that", () => {
        // -500..500 is 1000 wide: 0.76, under 0.85 of 1
        expect(initialViewport({ x: -252, y: 0, width: 504, height: 2000 }, laptop, 0, { x: -500, y: 0, width: 1000, height: 2000 })).toEqual({ x: 452, y: 64, zoom: 1 });
    });
});
