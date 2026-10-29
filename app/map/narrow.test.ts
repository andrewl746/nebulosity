import { describe, expect, it } from "vitest";
import { actionsPlace, actionsSide, bannerForm, bubblePlace, bubbleRoom, fitPopover, hoverCardRows, insideCanvas, trailStart } from "./narrow";

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

describe("bubblePlace (the line's card, its tail across the line at the spot: the owner, 2026-10-29)", () => {
    const canvas = { width: 700, height: 600 };
    const card = { width: 160, height: 80 };

    it("over a level line, reaches left from its tail, the tail 16 px in from the card's corner and its tip 1 px off the line", () => {
        // a 2 px line: the card's bottom keeps 1 + 1 + 7 = 9 px over its middle, so 300 - 9 - 80 = 211, and its right
        // edge is 16 past the spot, so 300 + 16 - 160 = 156, its tail 144 along its bottom
        expect(bubblePlace({ x: 300, y: 300 }, false, 1, card, canvas, [], [])).toEqual({ left: 156, top: 211, tail: { side: "bottom", at: 144 }, rises: true });
    });

    it("over a level line, reaches right near the left edge, and goes under it near the top", () => {
        expect(bubblePlace({ x: 100, y: 300 }, false, 1, card, canvas, [], [])).toEqual({ left: 84, top: 211, tail: { side: "bottom", at: 16 }, rises: true });
        // over it would start at 50 - 9 - 80 = -39, so under it, 50 + 9
        expect(bubblePlace({ x: 300, y: 50 }, false, 1, card, canvas, [], [])).toEqual({ left: 156, top: 59, tail: { side: "top", at: 144 }, rises: false });
        expect(bubblePlace({ x: 50, y: 50 }, false, 1, card, canvas, [], [])).toEqual({ left: 34, top: 59, tail: { side: "top", at: 16 }, rises: false });
    });

    it("beside an upright line, sits left of it rising from its tail, then right of it, then going down near the top", () => {
        // a 4 px line: 2 + 1 + 7 = 10 px off its middle, so 300 - 10 - 160 = 130, and the card's bottom 16 under the spot
        expect(bubblePlace({ x: 300, y: 300 }, true, 2, card, canvas, [], [])).toEqual({ left: 130, top: 236, tail: { side: "right", at: 64 }, rises: true });
        expect(bubblePlace({ x: 100, y: 300 }, true, 2, card, canvas, [], [])).toEqual({ left: 110, top: 236, tail: { side: "left", at: 64 }, rises: true });
        // rising, it would start at 40 + 16 - 80 = -24, so it goes down from 40 - 16
        expect(bubblePlace({ x: 300, y: 40 }, true, 2, card, canvas, [], [])).toEqual({ left: 130, top: 24, tail: { side: "right", at: 16 }, rises: false });
    });

    it("near the canvas's edge, slides along the line, its tail still on the spot, as far as the tail keeps 12 px from a corner", () => {
        // beside an upright line at 580, rising, the card would end at 596, past 592: slid up to 512, its tail 68 down
        // its side, 12 from its bottom corner
        expect(bubblePlace({ x: 300, y: 580 }, true, 2, card, canvas, [], [])).toEqual({ left: 130, top: 512, tail: { side: "right", at: 68 }, rises: true });
        // over a level line 20 px from the canvas's left side, every place starts left of 8: slid right to 8, its tail
        // 12 along its bottom
        expect(bubblePlace({ x: 20, y: 300 }, false, 1, card, canvas, [], [])).toEqual({ left: 8, top: 211, tail: { side: "bottom", at: 12 }, rises: true });
    });

    it("keeps off the rest of the line pointed at, and clear of what's over the canvas", () => {
        // the route turns up at x 200 to 210, under the card over and left of the spot, so it reaches right
        expect(bubblePlace({ x: 300, y: 300 }, false, 1, card, canvas, [{ left: 200, top: 0, width: 10, height: 300 }], [])).toEqual({ left: 284, top: 211, tail: { side: "bottom", at: 16 }, rises: true });
        // a box's actions from (100, 150) to (300, 250) take both places over the line, so it goes under it
        expect(bubblePlace({ x: 300, y: 300 }, false, 1, card, canvas, [], [{ left: 100, top: 150, width: 200, height: 100 }])).toEqual({ left: 156, top: 309, tail: { side: "top", at: 144 }, rises: false });
    });

    it("where every place is on the line somewhere, takes the first that keeps off the spot, its tail kept", () => {
        expect(bubblePlace({ x: 300, y: 300 }, false, 1, card, canvas, [{ left: 0, top: 0, width: 700, height: 600 }], [])).toEqual({ left: 156, top: 211, tail: { side: "bottom", at: 144 }, rises: true });
    });

    it("where no place fits the canvas, the first moved inside, with no tail, since it's no longer the tail's length off", () => {
        // a 200 × 150 canvas: over the line would start at 75 - 9 - 60 = 6, under it end at 84 + 60 = 144, past 142
        expect(bubblePlace({ x: 100, y: 75 }, false, 1, { width: 100, height: 60 }, { width: 200, height: 150 }, [], [])).toEqual({ left: 16, top: 8, tail: null, rises: true });
    });

    it("in a canvas too narrow for the card beside an upright line, goes just over or under the spot, with no tail", () => {
        // 184 px wide in a 200 px canvas, the card is on the line wherever it's moved in beside it, and over the spot it
        // would end at 100 - 6 - 1 = 93, so it starts 1 px under the spot's 6 px, at 107
        const narrow = { width: 200, height: 300 };
        expect(bubblePlace({ x: 100, y: 100 }, true, 2, { width: 184, height: 100 }, narrow, [{ left: 95, top: 0, width: 10, height: 300 }], [])).toEqual({ left: 8, top: 107, tail: null, rises: false });
    });

    it("and in a canvas too small for anything else, the first moved inside: it never leaves the canvas", () => {
        expect(bubblePlace({ x: 60, y: 45 }, false, 1, { width: 100, height: 60 }, { width: 120, height: 90 }, [{ left: 0, top: 0, width: 120, height: 90 }], [])).toEqual({ left: 8, top: 8, tail: null, rises: true });
    });
});

describe("insideCanvas (a pinned card the wheel's zoom took to an edge stays in sight)", () => {
    const canvas = { width: 700, height: 600 };
    const card = { width: 160, height: 208 };

    it("leaves a card that's inside the canvas where it is", () => {
        expect(insideCanvas({ left: 290, top: 200 }, card, canvas)).toEqual({ left: 290, top: 200 });
    });

    it("moves one past an edge back in, 8 px from it, the least it takes", () => {
        // 650 + 160 would pass 700 - 8, so 532; 500 + 208 would pass 592, so 384
        expect(insideCanvas({ left: 650, top: 500 }, card, canvas)).toEqual({ left: 532, top: 384 });
        expect(insideCanvas({ left: -40, top: -10 }, card, canvas)).toEqual({ left: 8, top: 8 });
    });
});

describe("bubbleRoom (the height the card has, past its tail)", () => {
    const canvas = { width: 700, height: 600 };

    it("is the room over a level line or under it, past the tail, whichever is more, inside the canvas's 8 px", () => {
        // a 2 px line at 100: over it 100 - 9 - 8 = 83, under it 600 - 8 - 100 - 9 = 483
        expect(bubbleRoom({ x: 300, y: 100 }, false, 1, 160, canvas)).toBe(483);
        expect(bubbleRoom({ x: 300, y: 500 }, false, 1, 160, canvas)).toBe(483);
    });

    it("beside an upright line, the canvas's height inside its edges, since the card slides along the line to fit", () => {
        expect(bubbleRoom({ x: 300, y: 100 }, true, 2, 160, canvas)).toBe(584);
    });

    it("beside an upright line within 20 px of the canvas's top or bottom, the room just over or under the spot", () => {
        // a spot at 585 leaves its tail no room 12 px from a corner beside it, so over it, 585 - 6 - 1 - 8 = 570
        expect(bubbleRoom({ x: 300, y: 585 }, true, 2, 160, canvas)).toBe(570);
    });

    it("where the card doesn't fit beside an upright line, the room just over or under the spot", () => {
        // 82 px each side of the line in a 200 px canvas, under the 184 px card: under the spot, 300 - 8 - 100 - 7 = 185
        expect(bubbleRoom({ x: 100, y: 100 }, true, 2, 184, { width: 200, height: 300 })).toBe(185);
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
