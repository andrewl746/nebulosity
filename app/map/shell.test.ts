import { describe, expect, it } from "vitest";
import { shellLayout } from "./shell";

// The owner's picks of 2026-10-27 (collapse option C and the height rules), worked by hand at the sizes the options
// were rendered at.
const at = (width: number, height: number, embedded = false, selected = true) => shellLayout({ width, height, embedded, selected });

describe("shellLayout: widths (collapse option C)", () => {
    it("keeps everything at full size on a wide window", () => {
        // 1920: explorer 236, inspector 300, so 1384 px of canvas
        expect(at(1920, 1080)).toMatchObject({ explorer: "full", inspector: "beside", canvasWidth: 1384 });
        expect(at(3840, 2160)).toMatchObject({ explorer: "full", inspector: "beside", canvasWidth: 3304 });
    });

    it("folds the explorer into a rail under 1180 px, and drops it under 600", () => {
        expect(at(1180, 820).explorer).toBe("full");
        expect(at(1179, 820).explorer).toBe("rail");
        expect(at(600, 900).explorer).toBe("rail");
        expect(at(599, 900).explorer).toBe("none");
    });

    it("keeps the inspector beside while 560 px of canvas is left", () => {
        // 1024: rail 40 + inspector 300 leaves 684
        expect(at(1024, 768)).toMatchObject({ explorer: "rail", inspector: "beside", canvasWidth: 684 });
        // 900: 900 - 40 - 300 = 560, just enough
        expect(at(900, 900).inspector).toBe("beside");
        expect(at(899, 900).inspector).toBe("below");
    });

    it("puts the inspector under the canvas in a window 640 px or taller, over it in a shorter one", () => {
        expect(at(820, 900)).toMatchObject({ inspector: "below", canvasWidth: 780 });
        expect(at(820, 640).inspector).toBe("below");
        expect(at(820, 639).inspector).toBe("drawer");
    });

    it("covers the canvas where the window is both narrow and short", () => {
        expect(at(390, 844).inspector).toBe("below");
        expect(at(599, 639).inspector).toBe("cover");
        expect(at(844, 390).inspector).toBe("drawer");
    });

    it("draws the inspector beside the canvas with nothing selected (the folder on screen), elsewhere only for a selection", () => {
        expect(at(1920, 1080, false, false).inspector).toBe("beside");
        expect(at(820, 900, false, false)).toMatchObject({ inspector: "none", canvasWidth: 780 });
        expect(at(844, 390, false, false).inspector).toBe("none");
    });

    it("never gives VS Code's panel an explorer", () => {
        // 1200: no explorer, so 1200 - 300 = 900 of canvas beside the inspector
        expect(at(1200, 900, true)).toMatchObject({ explorer: "none", inspector: "beside", canvasWidth: 900 });
        // a side split, 420 wide: 420 - 300 = 120 leaves no room beside, and 900 tall takes it under
        expect(at(420, 900, true).inspector).toBe("below");
        // the bottom panel, wide and short
        expect(at(1600, 300, true).inspector).toBe("beside");
    });
});

describe("shellLayout: heights", () => {
    it("drops the legend under 560 px tall, under a 420 px canvas, and under a drawer or a cover", () => {
        expect(at(1440, 560).legend).toBe(true);
        expect(at(1440, 559).legend).toBe(false);
        // 820 × 900 with the inspector under: the canvas is 780 wide
        expect(at(820, 900).legend).toBe(true);
        expect(at(419, 900, true).legend).toBe(false);
        expect(at(844, 600).legend).toBe(false);
    });

    it("folds the toolbar into the header under 420 px tall, and the status bar's dots under 300", () => {
        expect(at(1440, 420)).toMatchObject({ toolbarInHeader: false, status: "bar" });
        expect(at(1440, 419)).toMatchObject({ toolbarInHeader: true, status: "bar" });
        expect(at(1440, 300).status).toBe("bar");
        expect(at(1440, 299)).toMatchObject({ toolbarInHeader: true, status: "inHeader" });
    });

    it("keeps a 160 px canvas, the page scrolling down below that", () => {
        // a wide, short window: header 42 + status 24 + 160 (the toolbar folded, no legend) = 226
        expect(at(1440, 400).minHeight).toBe(226);
        // VS Code's bottom panel at 250: header 38 + 160, the toolbar folded and the dots in the header = 198
        expect(at(1600, 250, true).minHeight).toBe(198);
        // a full window: header 42 + toolbar 36 + status 24 + legend 44 + 160 = 306
        expect(at(1920, 1080).minHeight).toBe(306);
        // with the inspector under the canvas it takes 42% of the page: (42 + 36 + 24 + 44 + 160) / 0.58 = 527.6, so 528
        expect(at(820, 900).minHeight).toBe(528);
    });
});
