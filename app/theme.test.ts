import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// VISUAL_REFRESH.md §2, transcribed: each token's one value. The owner's final pick of 2026-10-12, "violet slate"
// (option 1 of the purple mockups): purple-tinted surfaces, lavender names and code, the selection still vivid purple.
const TOKENS: Record<string, string> = {
    canvas: "#12101A",
    surface: "#1D1A28",
    panel: "#17141F",
    hairline: "#272236",
    border: "#3E3752",
    text: "#F1EEF8",
    "text-body": "#CBC4DA",
    "text-2": "#B3ABC6",
    title: "#C7B3FF",
    code: "#D8CAFF",
    "code-bg": "#2A2240",
    folder: "#A98BEA",
    "neutral-edge": "#6A6285",
    select: "#B58AFF",
    "select-fill": "#2C2145",
    agent: "#F08A4B",
    ok: "#4CC38A",
    danger: "#F07A7A",
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
