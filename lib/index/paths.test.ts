import { describe, expect, it } from "vitest";
import { dirOf, joinRepoPath, normalizeSlashes } from "./paths";

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
