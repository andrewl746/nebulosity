import { describe, expect, it } from "vitest";
import fs from "fs";
import { importSpecifiers, resolveRelative } from "./scan";

describe("importSpecifiers", () => {
    it("reads every import form, skipping comment lines, catching a multi-line import by its from line", () => {
        const text = [
            "import { a } from './a.js';",
            'import type { B } from "../b";',
            "export * from './c';",
            'export { d } from "./d.js";',
            "import './side-effect.css';",
            "const e = await import('./e.js');",
            'const f = require("./f");',
            "// import { g } from './commented.js';",
            " * import { h } from './doc-comment.js';",
            "import {",
            "    i,",
            "} from './multi.js';",
        ].join("\n");
        expect(importSpecifiers(text)).toEqual(["./a.js", "../b", "./c", "./d.js", "./side-effect.css", "./e.js", "./f", "./multi.js"]);
    });

    it("reads a dynamic import with a bundler comment before the quote, and a minified side-effect import", () => {
        const text = 'const d = await import(/* webpackChunkName: "d" */ \'./d.js\');\nimport"./min.js";';
        expect(importSpecifiers(text)).toEqual(["./d.js", "./min.js"]);
    });
});

describe("resolveRelative", () => {
    const known = new Set(["src/a.ts", "src/b/index.ts", "src/c.tsx", "src/d.js", "lib/e.mts"]);

    it("resolves .js to .ts, adds extensions, finds index files", () => {
        expect(resolveRelative("src/x.ts", "./a.js", known)).toBe("src/a.ts");
        expect(resolveRelative("src/x.ts", "./b", known)).toBe("src/b/index.ts");
        expect(resolveRelative("src/x.ts", "./c", known)).toBe("src/c.tsx");
        expect(resolveRelative("src/x.ts", "./d.js", known)).toBe("src/d.js");
        expect(resolveRelative("src/x.ts", "../lib/e.mjs", known)).toBe("lib/e.mts");
        expect(resolveRelative("src/deep/x.ts", "../a", known)).toBe("src/a.ts");
    });

    it("leaves packages, missing files and non-code files unresolved", () => {
        expect(resolveRelative("src/x.ts", "react", known)).toBeNull();
        expect(resolveRelative("src/x.ts", "./missing", known)).toBeNull();
        expect(resolveRelative("src/x.ts", "./a.css", known)).toBeNull();
    });

    it("falls back to a .d.ts declaration file, after every real source candidate", () => {
        const declarations = new Set(["src/api/git.d.ts", "src/types/index.d.ts"]);
        expect(resolveRelative("src/x.ts", "./api/git", declarations)).toBe("src/api/git.d.ts");
        expect(resolveRelative("src/x.ts", "./api/git.js", declarations)).toBe("src/api/git.d.ts");
        expect(resolveRelative("src/x.ts", "./types", declarations)).toBe("src/types/index.d.ts");
        expect(resolveRelative("src/x.ts", "./api/git", new Set([...declarations, "src/api/git.ts"]))).toBe("src/api/git.ts");
    });

    it("resolves a bare or trailing-slash specifier to the index file of the folder it names", () => {
        const folders = new Set(["index.ts", "src/dir/index.ts", "src/index.ts"]);
        expect(resolveRelative("src/x.ts", "..", folders)).toBe("index.ts");
        expect(resolveRelative("src/x.ts", "./dir/", folders)).toBe("src/dir/index.ts");
        expect(resolveRelative("src/x.ts", "./", folders)).toBe("src/index.ts");
    });
});

describe("the scanner's independence (R3)", () => {
    it("imports nothing from lib/", () => {
        for (const file of ["scripts/eval/scan.ts", "scripts/eval/truth.ts"]){
            const imports = [...fs.readFileSync(file, "utf8").matchAll(/^import\s.*?from\s+"([^"]+)";?\s*$/gm)].map((m) => m[1]);
            expect({ file, fromLib: imports.filter((i) => i.includes("lib/")) }).toEqual({ file, fromLib: [] });
        }
    });
});
