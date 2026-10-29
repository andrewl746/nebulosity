import { describe, expect, it } from "vitest";
import { actionsPlace, actionsSide, bannerForm, fitPopover, hoverCardPlace, hoverCardRoom, hoverCardRows, trailStart } from "./narrow";

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

describe("hoverCardPlace (the line's hover card at the pointer: the owner, 2026-10-29)", () => {
    const canvas = { width: 700, height: 600 };
    const card = { width: 160, height: 80 };

    it("goes 12 px right of the pointer and 20 px below it, past the pointer's arrow", () => {
        expect(hoverCardPlace({ x: 100, y: 100 }, card, canvas, [], [])).toEqual({ left: 112, top: 120 });
    });

    it("flips to the left near the right edge, above near the bottom, and both in the corner, 8 px inside", () => {
        // 612 + 160 would pass 700 - 8, so it goes left, 600 - 8 - 160 = 432, and 8 px under the tip, left of the arrow
        expect(hoverCardPlace({ x: 600, y: 100 }, card, canvas, [], [])).toEqual({ left: 432, top: 108 });
        // 570 + 80 would pass 592, and left of the pointer is off the canvas: above and right, 8 px off the tip
        expect(hoverCardPlace({ x: 100, y: 550 }, card, canvas, [], [])).toEqual({ left: 108, top: 462 });
        expect(hoverCardPlace({ x: 600, y: 550 }, card, canvas, [], [])).toEqual({ left: 432, top: 462 });
    });

    it("from above and left first, 8 px off the tip, where nothing of the pointer is, then round the other corners", () => {
        expect(hoverCardPlace({ x: 300, y: 300 }, card, canvas, [], [], "above-left")).toEqual({ left: 132, top: 212 });
        // near the top, above is off the canvas, so below and left
        expect(hoverCardPlace({ x: 300, y: 50 }, card, canvas, [], [], "above-left")).toEqual({ left: 132, top: 58 });
        // in the top left corner, only below and right is left
        expect(hoverCardPlace({ x: 50, y: 50 }, card, canvas, [], [], "above-left")).toEqual({ left: 62, top: 70 });
    });

    it("slides sideways off an upright line the pointer is a few px beside, and down off a heavy level one", () => {
        // a 10 px line from x 108 to 118, the pointer 8 px left of its middle: the card starts at 112, so it moves to 118 + 4
        expect(hoverCardPlace({ x: 105, y: 100 }, card, canvas, [{ left: 108, top: 0, width: 10, height: 300 }], [])).toEqual({ left: 122, top: 120 });
        // a 26 px line from y 102 to 128 and the pointer 15 px over its middle: 120 is on it, so 128 + 4
        expect(hoverCardPlace({ x: 100, y: 100 }, card, canvas, [{ left: 0, top: 102, width: 400, height: 26 }], [])).toEqual({ left: 112, top: 132 });
    });

    it("keeps clear of a drawer over the canvas, as of its edge", () => {
        // the drawer from x 380: 312 + 160 runs under it, so the card goes left, 300 - 8 - 160 = 132
        expect(hoverCardPlace({ x: 300, y: 100 }, card, canvas, [], [{ left: 380, top: 0, width: 320, height: 600 }])).toEqual({ left: 132, top: 108 });
    });

    it("where no side fits, takes the first that fits moved inside the canvas and still clear of the line", () => {
        // a 200 × 150 canvas: right of the pointer runs past 192, left of it past 8, and above it past 8 (75 - 8 - 60 = 7).
        // Moved in, below and right is at (92, 82), on the line from x 150; below and left is at (8, 82), clear of it
        const small = { width: 200, height: 150 };
        expect(hoverCardPlace({ x: 100, y: 75 }, { width: 100, height: 60 }, small, [{ left: 150, top: 0, width: 10, height: 150 }], [])).toEqual({ left: 8, top: 82 });
    });

    it("in a canvas too small to keep off the line, still keeps off the line right at the pointer", () => {
        // the line runs down through the pointer at (100, 160). Moved in, below and right is at (92, 132) and below and
        // left at (8, 132), both over the pointer's 6 px, while above and right, at (92, 92), ends at 152, under 154
        const small = { width: 200, height: 200 };
        expect(hoverCardPlace({ x: 100, y: 160 }, { width: 100, height: 60 }, small, [{ left: 95, top: 0, width: 10, height: 200 }], [])).toEqual({ left: 92, top: 92 });
    });

    it("and failing that, the first moved inside the canvas: it never leaves it", () => {
        // a 120 × 90 canvas leaves a 100 × 60 card nowhere off the pointer
        expect(hoverCardPlace({ x: 60, y: 45 }, { width: 100, height: 60 }, { width: 120, height: 90 }, [{ left: 0, top: 0, width: 120, height: 90 }], [])).toEqual({ left: 12, top: 22 });
    });
});

describe("hoverCardRoom (the height the hover card has, over or under the pointer)", () => {
    it("is the room under the pointer, past its arrow, or over it, whichever is more, inside the canvas's 8 px", () => {
        // under: 600 - 8 - 100 - 20 = 472; over: 100 - 8 - 8 = 84
        expect(hoverCardRoom(100, 600)).toBe(472);
        // under: 600 - 8 - 500 - 20 = 72; over: 500 - 8 - 8 = 484
        expect(hoverCardRoom(500, 600)).toBe(484);
    });
});

describe("hoverCardRows (how many of a run's lines the hover card lists)", () => {
    it("lists five, and all six where the sixth would only replace the 'and 1 more' row", () => {
        expect(hoverCardRows(3, 500)).toBe(3);
        expect(hoverCardRows(6, 500)).toBe(6);
        expect(hoverCardRows(7, 500)).toBe(5);
        expect(hoverCardRows(43, 500)).toBe(5);
    });

    it("lists fewer where the canvas is short: a 150 px canvas leaves 134 px, the frame, the title, 4 rows and the more row", () => {
        // 10 + 18 × (1 + 4 + 1) = 118 fits in 134, 10 + 18 × 7 = 136 doesn't
        expect(hoverCardRows(43, 134)).toBe(4);
        expect(hoverCardRows(4, 64)).toBe(1);
    });
});
