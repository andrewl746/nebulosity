import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// VISUAL_REFRESH.md §2, transcribed: each token's one value. The owner's pick of 2026-10-12 (cool slate surfaces from
// option C, blue titles and code from option B) replaced the first table's grays and added the blue tokens.
const TOKENS: Record<string, string> = {
    canvas: "#0F131A",
    surface: "#1A212C",
    panel: "#141A23",
    hairline: "#232B38",
    border: "#3A4659",
    text: "#EEF2F8",
    "text-body": "#C3CBD8",
    "text-2": "#AEB8C8",
    title: "#9CC4FF",
    code: "#A9CBFF",
    "code-bg": "#1B2940",
    folder: "#7FB2F0",
    "neutral-edge": "#5A6680",
    select: "#B58AFF",
    "select-fill": "#251E36",
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
