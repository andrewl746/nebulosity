import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// VISUAL_REFRESH.md §2, transcribed: each token's one value. --danger is the §2 addition V1.3.1 made for errors.
const TOKENS: Record<string, string> = {
    canvas: "#111318",
    surface: "#1B1D24",
    panel: "#16181F",
    hairline: "#262933",
    border: "#3A3E4A",
    text: "#F0F1F5",
    "text-2": "#B1B5C0",
    "neutral-edge": "#4A4F5C",
    select: "#B58AFF",
    "select-fill": "#241D33",
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
