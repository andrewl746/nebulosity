import { describe, expect, it } from "vitest";
import { applyTheme, DARK_2026, earlyThemeScript, fromTheme, mix, parseColor, themeInputOf, type ThemeInput } from "./theme";

// The five themes of the approved mockup (mockup3.html's THEMES, read from VS Code's installed theme files), and what the
// mockup's own fromTheme gave for each, transcribed from a run of the mockup's script (2026-10-27, the owner's picks):
// the Map's port of the rule must draw exactly what the owner approved.
const THEMES: Record<string, ThemeInput> = {
    dark2026: DARK_2026,
    light2026: { kind: "light", editor: "#FFFFFF", side: "#FAFAFD", border: "#E2E2E5", fg: "#202020", desc: "#606060" },
    solarized: { kind: "dark", editor: "#002B36", side: "#00212B", fg: "#CCCCCC" },
    monokai: { kind: "dark", editor: "#272822", side: "#1E1F1C", border: "#414339", fg: "#F8F8F2" },
    hc: { kind: "hc", editor: "#000000", side: "#000000", border: "#6FC3DF", fg: "#FFFFFF", desc: "#FFFFFF" },
};

// mockup name -> the Map's token name
const NAMES: Record<string, string> = {
    bg: "canvas", panel: "panel", node: "node", nodeSel: "node-sel", rowSel: "row-sel", divider: "divider", line: "border",
    linked: "linked-border", text: "text", text2: "text-2", text3: "text-3", dimEdge: "edge-dim", dimGlyph: "glyph-dim",
    accent: "accent", lilac: "linked-glyph", strong: "edge-strong", core: "core", onAccent: "on-accent",
};

const MOCKUP: Record<string, Record<string, string>> = {
    dark2026: { bg: "#121314", panel: "#191A1B", node: "#222223", nodeSel: "#2a1e38", rowSel: "#332543", divider: "#2A2B2C", line: "#464747", linked: "#8345be", text: "#BFBFBF", text2: "#999999", text3: "#8C8C8C", dimEdge: "#464747", dimGlyph: "#606061", accent: "#A855F7", lilac: "#C084FC", strong: "#E9D5FF", core: "#F0FDFF", onAccent: "#120C1C" },
    light2026: { bg: "#FFFFFF", panel: "#FAFAFD", node: "#f4f4f4", nodeSel: "#f4ebfd", rowSel: "#eee2fb", divider: "#E2E2E5", line: "#c1c1c1", linked: "#ae66ef", text: "#202020", text2: "#515151", text3: "#606060", dimEdge: "#bcbcbc", dimGlyph: "#a6a6a6", accent: "#9333EA", lilac: "#A855F7", strong: "#7E22CE", core: "#9333EA", onAccent: "#FFFFFF" },
    solarized: { bg: "#002B36", panel: "#00212B", node: "#123944", nodeSel: "#1b3255", rowSel: "#1e2a50", divider: "#183e48", line: "#3d5b63", linked: "#7e4bc7", text: "#CCCCCC", text2: "#9fa9ab", text3: "#8f9c9f", dimEdge: "#3d5b63", dimGlyph: "#5c737a", accent: "#A855F7", lilac: "#C084FC", strong: "#E9D5FF", core: "#F0FDFF", onAccent: "#120C1C" },
    monokai: { bg: "#272822", panel: "#1E1F1C", node: "#3a3b35", nodeSel: "#3c2f44", rowSel: "#372943", divider: "#414339", line: "#666660", linked: "#884ac2", text: "#F8F8F2", text2: "#cacac4", text3: "#b9bab4", dimEdge: "#666660", dimGlyph: "#858680", accent: "#A855F7", lilac: "#C084FC", strong: "#E9D5FF", core: "#F0FDFF", onAccent: "#120C1C" },
    hc: { bg: "#000000", panel: "#000000", node: "#000000", nodeSel: "#1b0e28", rowSel: "#1e0f2c", divider: "#6FC3DF", line: "#6FC3DF", linked: "#C084FC", text: "#FFFFFF", text2: "#c7c7c7", text3: "#FFFFFF", dimEdge: "#808080", dimGlyph: "#999999", accent: "#A855F7", lilac: "#C084FC", strong: "#E9D5FF", core: "#F0FDFF", onAccent: "#120C1C" },
};

describe("fromTheme, the approved mockup's rule", () => {
    for (const [name, input] of Object.entries(THEMES)){
        it(`draws ${name} exactly as the mockup did`, () => {
            const palette = fromTheme(input) as Record<string, string>;
            for (const [mockupName, hex] of Object.entries(MOCKUP[name])){
                expect(palette[NAMES[mockupName]], `${name} ${NAMES[mockupName]}`).toBe(hex.toUpperCase());
            }
        });
    }

    it("fades a box to 50%, and to 70% on high contrast", () => {
        expect(fromTheme(THEMES.dark2026).fade).toBe("50%");
        expect(fromTheme(THEMES.light2026).fade).toBe("50%");
        expect(fromTheme(THEMES.hc).fade).toBe("70%");
    });

    it("takes the theme's focus ring when it has one", () => {
        expect(fromTheme({ ...DARK_2026, focus: "#3994BC" }).focus).toBe("#3994BC");
        expect(fromTheme(DARK_2026).focus).toBe("#67E8F9");
    });

    it("draws a high contrast light theme with its border and the light purples", () => {
        const palette = fromTheme({ kind: "hc-light", editor: "#FFFFFF", side: "#FFFFFF", border: "#0F4A85", fg: "#292929" });
        expect(palette.node).toBe("#FFFFFF");
        expect(palette.border).toBe("#0F4A85");
        expect(palette.accent).toBe("#9333EA");
        expect(palette["linked-border"]).toBe("#7E22CE");
        expect(palette.fade).toBe("70%");
    });
});

describe("fromTheme, what uses the selection (the owner's pink, 2026-10-28, moved off purple 2026-10-29)", () => {
    const pinks = (input: ThemeInput) => { const p = fromTheme(input); return [p["used-by-edge"], p["used-by-bar"], p["used-by-accent"]]; };
    it("takes the owner's dark values on dark themes and high contrast dark", () => {
        for (const name of ["dark2026", "solarized", "monokai", "hc"]) expect(pinks(THEMES[name]), name).toEqual(["#F472B6", "#EC4899", "#EC4899"]);
    });
    it("takes the owner's light values on light themes", () => {
        expect(pinks(THEMES.light2026)).toEqual(["#DB2777", "#EC4899", "#DB2777"]);
    });
    it("goes a step darker on high contrast light, as purple does", () => {
        expect(pinks({ kind: "hc-light", editor: "#FFFFFF", side: "#FFFFFF", border: "#0F4A85", fg: "#292929" })).toEqual(["#BE185D", "#DB2777", "#BE185D"]);
    });
});

describe("mix", () => {
    it("moves each channel the given share of the way, rounding to the nearest", () => {
        // 18 + (191 - 18) × 0.09 = 33.57 → 34 (0x22), 19 + 172 × 0.09 = 34.48 → 34 (0x22), 20 + 171 × 0.09 = 35.39 → 35 (0x23)
        expect(mix("#121314", "#BFBFBF", 0.09)).toBe("#222223");
        expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    });
});

describe("parseColor", () => {
    it("reads hex in every length and rgb()", () => {
        expect(parseColor("#fff")).toBe("#FFFFFF");
        expect(parseColor(" #1F1F1F ")).toBe("#1F1F1F");
        expect(parseColor("rgb(1, 2, 3)")).toBe("#010203");
    });

    it("lays a see-through color over the background", () => {
        // VS Code's default panel border, #80808059 (alpha 89/255 = 0.349), over Dark 2026's #121314:
        // 18 + 110 × 0.349 = 56.4 → 0x38, 19 + 109 × 0.349 = 57.0 → 0x39, 20 + 108 × 0.349 = 57.7 → 0x3A
        expect(parseColor("#80808059", "#121314")).toBe("#38393A");
        // 128 × 0.35 = 44.8 → 0x2D
        expect(parseColor("rgba(128, 128, 128, 0.35)")).toBe("#2D2D2D");
    });

    it("refuses anything else", () => {
        expect(parseColor("red")).toBeNull();
        expect(parseColor("#12345")).toBeNull();
        expect(parseColor("var(--x)")).toBeNull();
        expect(parseColor("")).toBeNull();
    });
});

describe("themeInputOf (a nebulosity.theme message, API_CONTRACTS §20)", () => {
    it("reads each color as hex, laying a see-through one over the editor's background", () => {
        expect(themeInputOf("dark", { editor: "#121314", side: "#191a1b", fg: "#bfbfbf", border: "#80808059", desc: "rgb(140, 140, 140)" })).toEqual({
            kind: "dark", editor: "#121314", side: "#191A1B", fg: "#BFBFBF",
            // 18 + 110 × 0.349 = 56.4, 19 + 109 × 0.349 = 57.0, 20 + 108 × 0.349 = 57.7 (parseColor's test)
            border: "#38393A", desc: "#8C8C8C", focus: undefined,
        });
    });

    it("drops an optional color it can't read, and gives null without the editor's, the side bar's or the text's", () => {
        expect(themeInputOf("light", { editor: "#fff", side: "#fafafd", fg: "#202020", border: "var(--x)" })?.border).toBeUndefined();
        expect(themeInputOf("light", { editor: "white", side: "#fafafd", fg: "#202020" })).toBeNull();
        expect(themeInputOf("light", { editor: "#fff", side: "", fg: "#202020" })).toBeNull();
        expect(themeInputOf("light", { editor: "#fff", side: "#fafafd", fg: "black" })).toBeNull();
    });
});

/** A stand-in for the page's <html>: what was set on its style and as attributes. */
function fakeRoot(){
    const style: Record<string, string> = {};
    const attributes: Record<string, string> = {};
    return {
        style: { setProperty: (name: string, value: string) => { style[name] = value; } },
        setAttribute: (name: string, value: string) => { attributes[name] = value; },
        style_: style,
        attributes,
    };
}

describe("applyTheme", () => {
    it("sets every token and names the kind", () => {
        const root = fakeRoot();
        applyTheme(root, THEMES.monokai);
        for (const [mockupName, hex] of Object.entries(MOCKUP.monokai)) expect(root.style_[`--${NAMES[mockupName]}`], NAMES[mockupName]).toBe(hex.toUpperCase());
        expect(root.style_["--fade"]).toBe("50%");
        // a theme change inside VS Code's panel brings the pink too, so a selected box's Used by follows the theme
        expect(root.style_["--used-by-edge"]).toBe("#F472B6");
        expect(root.attributes["data-kind"]).toBe("dark");
    });
});

describe("earlyThemeScript (before the first paint, app/layout.tsx)", () => {
    /** Runs the script against a stand-in page at this address. */
    function run(search: string){
        const root = fakeRoot();
        new Function("location", "document", earlyThemeScript())({ search }, { documentElement: root });
        return root;
    }

    it("inside VS Code's panel, gives a light theme's Map Light 2026's tokens from the start", () => {
        const root = run("?embed=vscode&kind=light");
        // Light 2026 is the mockup's own light theme, so these are the mockup's values
        for (const [mockupName, hex] of Object.entries(MOCKUP.light2026)) expect(root.style_[`--${NAMES[mockupName]}`], NAMES[mockupName]).toBe(hex.toUpperCase());
        expect(root.attributes["data-kind"]).toBe("light");
    });

    it("gives high contrast its stand-in too", () => {
        const root = run("?path=src&embed=vscode&kind=hc");
        for (const [mockupName, hex] of Object.entries(MOCKUP.hc)) expect(root.style_[`--${NAMES[mockupName]}`], NAMES[mockupName]).toBe(hex.toUpperCase());
        expect(root.attributes["data-kind"]).toBe("hc");
    });

    it("does nothing for dark, an unknown kind, or outside the panel", () => {
        for (const search of ["?embed=vscode&kind=dark", "?embed=vscode&kind=toString", "?embed=vscode", "?kind=light", ""]){
            const root = run(search);
            expect(Object.keys(root.style_), search).toEqual([]);
            expect(root.attributes, search).toEqual({});
        }
    });
});
