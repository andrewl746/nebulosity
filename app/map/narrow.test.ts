import { describe, expect, it } from "vitest";
import { actionsPlace, actionsSide, bannerForm, fitPopover, trailStart } from "./narrow";

describe("actionsSide (a selected box's actions, while the panel would cover the canvas: owner review 2026-10-25)", () => {
    it("goes under a box whose middle is in the canvas's top half, clear of the page pill's band", () => {
        expect(actionsSide(64, 56, 600)).toBe("bottom");
        expect(actionsSide(240, 56, 600)).toBe("bottom");   // its middle at 268, above 300
    });

    it("goes over a box whose middle is at or below the canvas's middle, clear of the legend and the zoom controls", () => {
        expect(actionsSide(272, 56, 600)).toBe("top");   // its middle exactly at 300
        expect(actionsSide(500, 56, 600)).toBe("top");
    });

    it("goes by the box's size on screen: zoomed out to 75%, a box's middle is higher", () => {
        expect(actionsSide(270, 42, 600)).toBe("bottom");   // its middle at 291
    });
});

describe("actionsPlace (the actions' corner on the canvas)", () => {
    const actions = { width: 150, height: 36 };

    it("centres them on the box, 8 px under it in the canvas's top half and 8 px over it lower down", () => {
        // a 232 × 56 box at (100, 64): its middle at x 216, so the actions start at 216 - 75
        expect(actionsPlace({ left: 100, top: 64, width: 232, height: 56 }, actions, 440, 600)).toEqual({ left: 141, top: 128 });
        expect(actionsPlace({ left: 100, top: 400, width: 232, height: 56 }, actions, 440, 600)).toEqual({ left: 141, top: 356 });
    });

    it("keeps them 8 px inside the canvas's sides when the box hangs off one (the layout check's 360 px floor)", () => {
        // a 174 px box (75%) starting 14 px off the left edge would put centred actions 2 px off it
        expect(actionsPlace({ left: -14, top: 64, width: 174, height: 42 }, actions, 360, 600).left).toBe(8);
        expect(actionsPlace({ left: 300, top: 64, width: 174, height: 42 }, actions, 360, 600).left).toBe(360 - 8 - 150);
    });
});

describe("bannerForm", () => {
    it("is a line in the pill's band while it stays inside it: 24 px down, at most 64 - 24 = 40 px tall", () => {
        expect(bannerForm(null)).toBe("band");
        // one line of 13 px text at the page's 1.5 line height is 19.5 px, two are 39
        expect(bannerForm(19.5)).toBe("band");
        expect(bannerForm(39)).toBe("band");
        expect(bannerForm(40)).toBe("band");
    });

    it("is a card once it would run below the band, onto the boxes", () => {
        // three lines: 58.5 px, ending at 82.5
        expect(bannerForm(40.5)).toBe("card");
        expect(bannerForm(58.5)).toBe("card");
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
