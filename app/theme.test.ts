import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { DARK_2026, fromTheme } from "./map/theme";

// The Workbench redesign (2026-10-27): the tokens are app/map/theme.ts's fromTheme for VS Code's Dark 2026, the
// browser's and the demo's fixed palette. theme.ts's own tests check fromTheme against the approved mockup; this checks
// that globals.css holds its result, each token once, so the page's first paint is already right.
const palette = fromTheme(DARK_2026);

const css = readFileSync("app/globals.css", "utf8");
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("the color tokens", () => {
    it("defines every color token exactly once, with fromTheme's value for Dark 2026", () => {
        for (const [name, value] of Object.entries(palette)){
            if (name === "fade") continue;
            // "--text:" must not also count "--text-2:": the name ends at the colon
            const definitions = css.match(new RegExp(`--${escape(name)}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g")) ?? [];
            expect(definitions, `--${name}`).toHaveLength(1);
            expect(definitions.join("").toUpperCase(), `--${name}`).toContain(value.toUpperCase());
        }
    });

    it("defines the fade once, as a share of the box's own color", () => {
        const definitions = css.match(/--fade:\s*([\d.]+%)\s*;/g) ?? [];
        expect(definitions).toHaveLength(1);
        expect(definitions[0]).toContain(palette.fade);
    });

    it("hands every color token to Tailwind, so components write bg-node rather than a hex value", () => {
        for (const name of Object.keys(palette)){
            if (name === "fade") continue;
            expect(css, `--color-${name}`).toMatch(new RegExp(`--color-${escape(name)}:\\s*var\\(--${escape(name)}\\)\\s*;`));
        }
    });
});
