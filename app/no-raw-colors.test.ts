import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/** Every component under app/, recursively. */
function components(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return components(full);
        return entry.name.endsWith(".tsx") ? [full] : [];
    });
}

// VISUAL_REFRESH.md §9: "Every token in §2 is defined once and used everywhere: no raw hex in components." Tailwind's
// own palette is a raw color too, just spelled differently, so its names count as well.
const RAW = [
    { what: "a hex color", pattern: /#[0-9a-fA-F]{3,8}\b/ },
    { what: "an rgb()/rgba() color", pattern: /rgba?\(/ },
    { what: "a Tailwind palette color", pattern: /\b(zinc|purple|cyan|amber|red|green|slate|gray|violet|black|white)-\d{2,3}\b|\b(bg|text|border)-(black|white)\b/ },
];

describe("no raw colors in components (VISUAL_REFRESH.md §9)", () => {
    for (const file of components("app")){
        it(file.replaceAll("\\", "/"), () => {
            const lines = readFileSync(file, "utf8").split("\n");
            const hits = lines.flatMap((line, i) =>
                RAW.filter(({ pattern }) => pattern.test(line)).map(({ what }) => `line ${i + 1}: ${what}: ${line.trim()}`));
            expect(hits).toEqual([]);
        });
    }
});
