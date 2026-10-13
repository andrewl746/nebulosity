import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// VISUAL_REFRESH.md §2, transcribed: each token's one value. The owner's pick of 2026-10-13, "night violet + cyan"
// (option C of the whole-screen mockups), from the logo's colours: night-violet surfaces, lavender names and code, the
// selection still vivid purple, the logo's violet for the overlays and its cyan for everything you click. Then, from
// the owner's review of an outside critique: content first (brighter boxes, a stronger selected fill, a faint dot grid)
// and quiet controls (one raised night-violet style for every overlay).
const TOKENS: Record<string, string> = {
    canvas: "#0E0A1C",
    surface: "#22193F",
    panel: "#140E28",
    hairline: "#261B45",
    border: "#4B3B85",
    text: "#F1EEF8",
    "text-body": "#D3C7EE",
    "text-2": "#B9A9DE",
    title: "#C7B3FF",
    code: "#D8CAFF",
    "code-bg": "#2A1B52",
    folder: "#A98BEA",
    "neutral-edge": "#7262A6",
    select: "#B58AFF",
    "select-fill": "#3A2178",
    agent: "#F08A4B",
    ok: "#4CC38A",
    danger: "#F07A7A",
    control: "#67E8F9",
    overlay: "#2A1F52",
    "overlay-line": "#3A2D6B",
    "overlay-text-2": "#C9BCEB",
    grid: "#262039",
};

const css = readFileSync("app/globals.css", "utf8");
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("the color tokens (VISUAL_REFRESH.md §2)", () => {
    it("defines every token exactly once, with the spec's value", () => {
        for (const [name, hex] of Object.entries(TOKENS)){
            // "--text:" must not also count "--text-2:": the name ends at the colon
            const definitions = css.match(new RegExp(`--${escape(name)}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g")) ?? [];
            expect(definitions, `--${name}`).toHaveLength(1);
            expect(definitions.join("").toUpperCase(), `--${name}`).toContain(hex.toUpperCase());
        }
    });

    it("hands every token to Tailwind, so components write bg-surface rather than a hex value", () => {
        for (const name of Object.keys(TOKENS)){
            expect(css, `--color-${name}`).toMatch(new RegExp(`--color-${escape(name)}:\\s*var\\(--${escape(name)}\\)\\s*;`));
        }
    });
});
