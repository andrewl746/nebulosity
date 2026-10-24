import { describe, expect, it } from "vitest";
import { fitPopover, MIN_HEIGHT, MIN_WIDTH, PANEL_WIDTH, panelLayout, pillForm, trailStart } from "./narrow";

describe("the floor (VISUAL_REFRESH.md, Narrow windows)", () => {
    it("is 360 × 320, and the panel's widest is 400", () => {
        expect(MIN_WIDTH).toBe(360);
        expect(MIN_HEIGHT).toBe(320);
        expect(PANEL_WIDTH).toBe(400);
    });
});

describe("panelLayout", () => {
    it("is the 400 px panel beside the canvas before the Map has been measured", () => {
        expect(panelLayout(null)).toEqual({ width: 400, covers: false });
    });

    it("stays 400 px beside the canvas while 360 px of canvas is left beside it", () => {
        // 1440: 1040 left; 760: exactly 360 left
        expect(panelLayout(1440)).toEqual({ width: 400, covers: false });
        expect(panelLayout(760)).toEqual({ width: 400, covers: false });
    });

    it("covers the whole canvas once less than 360 px would be left", () => {
        // 759: 359 left beside a 400 px panel; 400: none; 360: the floor
        expect(panelLayout(759)).toEqual({ width: 759, covers: true });
        expect(panelLayout(400)).toEqual({ width: 400, covers: true });
        expect(panelLayout(360)).toEqual({ width: 360, covers: true });
    });
});

describe("pillForm", () => {
    it("says it all with 440 px of canvas or more", () => {
        expect(pillForm(null)).toBe("full");
        expect(pillForm(1040)).toBe("full");
        expect(pillForm(440)).toBe("full");
    });

    it("keeps the page alone from 240 px, then the bare numbers", () => {
        expect(pillForm(439)).toBe("page");
        expect(pillForm(360)).toBe("page");
        expect(pillForm(240)).toBe("page");
        expect(pillForm(239)).toBe("numbers");
    });
});

describe("trailStart", () => {
    // four steps, 4 px apart: 60 + 4 + 50 + 4 + 40 + 4 + 70 = 232 px in all; "…" is 20 px
    const widths = [60, 50, 40, 70];

    it("folds nothing while the whole trail fits", () => {
        expect(trailStart(widths, 232, 20, 4)).toBe(0);
        expect(trailStart(widths, 500, 20, 4)).toBe(0);
    });

    it("folds steps from the start into one \"…\", as few as fit", () => {
        // from step 1: 20 + 4 + 50 + 4 + 40 + 4 + 70 = 192
        expect(trailStart(widths, 231, 20, 4)).toBe(1);
        expect(trailStart(widths, 192, 20, 4)).toBe(1);
        // from step 2: 20 + 4 + 40 + 4 + 70 = 138
        expect(trailStart(widths, 191, 20, 4)).toBe(2);
        expect(trailStart(widths, 138, 20, 4)).toBe(2);
        // from step 3: 20 + 4 + 70 = 94
        expect(trailStart(widths, 137, 20, 4)).toBe(3);
    });

    it("always shows the last step, which then truncates itself", () => {
        expect(trailStart(widths, 50, 20, 4)).toBe(3);
        expect(trailStart(widths, 0, 20, 4)).toBe(3);
    });

    it("has nothing to fold in a trail of one", () => {
        expect(trailStart([300], 100, 20, 4)).toBe(0);
        expect(trailStart([], 100, 20, 4)).toBe(0);
    });
});

describe("fitPopover", () => {
    const map = { left: 0, right: 1440 };

    it("leaves a popover where it is when it fits with 16 px to spare", () => {
        // the repo list at the repo's name; the status menu's right edge on the pill's, which is 16 px in
        expect(fitPopover({ left: 144, right: 300 }, map, 320, "start")).toEqual({ shift: 0, width: 320 });
        expect(fitPopover({ left: 1300, right: 1424 }, map, 340, "end")).toEqual({ shift: 0, width: 340 });
    });

    it("moves it in, as far as needed, to keep 16 px from the Map's edge", () => {
        // 300 + 320 = 620 would pass 400 - 16 = 384: 236 px to the left
        expect(fitPopover({ left: 300, right: 340 }, { left: 0, right: 400 }, 320, "start")).toEqual({ shift: -236, width: 320 });
        // a right edge at 350 puts the left one at 350 - 340 = 10 < 16: 6 px to the right
        expect(fitPopover({ left: 330, right: 350 }, { left: 0, right: 400 }, 340, "end")).toEqual({ shift: 6, width: 340 });
    });

    it("narrows it only when the Map is narrower than it and both margins", () => {
        // 360 - 32 = 328 wide, from x = 16
        expect(fitPopover({ left: 67, right: 200 }, { left: 0, right: 360 }, 340, "start")).toEqual({ shift: -51, width: 328 });
        expect(fitPopover({ left: 300, right: 344 }, { left: 0, right: 360 }, 340, "end")).toEqual({ shift: 0, width: 328 });
    });
});
