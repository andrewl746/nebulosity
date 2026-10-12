import { describe, expect, it } from "vitest";
import { dirOf, joinRepoPath, normalizeSlashes, parseRepoPath } from "./paths";

describe("paths", () => {
    it("normalizes Windows separators", () => {
        expect(normalizeSlashes("src\\app\\main.ts")).toBe("src/app/main.ts");
    });

    it("dirOf returns the folder, or '' at the repo root", () => {
        expect(dirOf("src/app/main.ts")).toBe("src/app");
        expect(dirOf("index.ts")).toBe("");
    });

    it("joinRepoPath collapses . and ..", () => {
        expect(joinRepoPath("src/app", "../core/log")).toBe("src/core/log");
        expect(joinRepoPath("", "./a")).toBe("a");
        expect(joinRepoPath("src", "./x/../y")).toBe("src/y");
    });

    it("joinRepoPath returns null when the path climbs above the repo root", () => {
        expect(joinRepoPath("src", "../../outside")).toBeNull();
    });
});

describe("parseRepoPath", () => {
    it("puts a path from outside in the stored spelling", () => {
        expect(parseRepoPath("")).toBe("");
        expect(parseRepoPath(".")).toBe("");
        expect(parseRepoPath("src/app")).toBe("src/app");
        expect(parseRepoPath("./src/app/")).toBe("src/app");
        expect(parseRepoPath("src\\app\\main.ts")).toBe("src/app/main.ts");
        expect(parseRepoPath("  src//app  ")).toBe("src/app");
    });

    it("refuses anything that could name a place outside the repo", () => {
        for (const raw of ["../etc/passwd", "src/../../x", "src/..", "/etc/passwd", "C:/Users", "c:\\x", "a\0b"]){
            expect(parseRepoPath(raw)).toBeNull();
        }
        expect(parseRepoPath(null)).toBeNull();
        expect(parseRepoPath(undefined)).toBeNull();
    });

    it("keeps names with spaces, #, %, + and non-ASCII letters as they are", () => {
        expect(parseRepoPath("src/my file#1%+é.ts")).toBe("src/my file#1%+é.ts");
    });
});
