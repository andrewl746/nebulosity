import { describe, expect, it } from "vitest";
import type { RepoList } from "../../lib/contracts";
import { checkRepoPath, relativeIn, repoFor, samePath, upperCaseDrive, uriPathOf } from "./repoMatch";

const repo = (root: string) => ({ root, name: root.slice(root.lastIndexOf("/") + 1), indexedAt: null });
const list = (roots: string[], active: string | null = null): RepoList => ({ active, repos: roots.map(repo) });

describe("samePath", () => {
    it("is case-insensitive on Windows only", () => {
        expect(samePath("c:\\Users\\Andrew\\x\\", "C:/Users/Andrew/x", "win32")).toBe(true);
        expect(samePath("/home/a/Repo", "/home/a/repo", "linux")).toBe(false);
        expect(samePath("/home/a/repo/", "/home/a/repo", "linux")).toBe(true);
    });
});

describe("repoFor (the indexed repo of a workspace folder, Review Focus 1)", () => {
    const vscode = list(["C:/Users/Andrew/Programming/vscode", "C:/Users/Andrew/Programming/vscode-docs"]);

    it("matches VS Code's spelling of a Windows path", () => {
        expect(repoFor(vscode, "c:\\Users\\Andrew\\Programming\\vscode", "win32")?.root).toBe("C:/Users/Andrew/Programming/vscode");
        expect(repoFor(vscode, "c:\\Users\\Andrew\\Programming\\vscode\\src", "win32")?.root).toBe("C:/Users/Andrew/Programming/vscode");
        expect(repoFor(vscode, "c:\\Users\\Andrew\\Programming\\vscode-docs", "win32")?.root).toBe("C:/Users/Andrew/Programming/vscode-docs");
    });

    it("gives null outside every root, and for a folder above them (P15)", () => {
        expect(repoFor(vscode, "D:\\other", "win32")).toBeNull();
        expect(repoFor(vscode, "c:\\Users\\Andrew\\Programming", "win32")).toBeNull();
    });

    it("takes the longest root of nested repos", () => {
        const nested = list(["/a/repo", "/a/repo/packages/web"]);
        expect(repoFor(nested, "/a/repo/packages/web/src", "linux")?.root).toBe("/a/repo/packages/web");
        expect(repoFor(nested, "/a/repo/docs", "linux")?.root).toBe("/a/repo");
    });

    it("takes the active one of two roots a drive-letter case apart, else the first listed (P15)", () => {
        expect(repoFor(list(["C:/Users/Andrew/x", "c:/Users/Andrew/x"], "c:/Users/Andrew/x"), "C:\\Users\\Andrew\\x", "win32")?.root).toBe("c:/Users/Andrew/x");
        expect(repoFor(list(["C:/Users/Andrew/x", "c:/Users/Andrew/x"], null), "C:\\Users\\Andrew\\x", "win32")?.root).toBe("C:/Users/Andrew/x");
    });
});

describe("relativeIn", () => {
    it("gives the forward-slash path inside the root", () => {
        expect(relativeIn("C:/Users/Andrew/Programming/vscode", "c:\\Users\\Andrew\\Programming\\vscode\\src\\vs\\a.ts", "win32")).toBe("src/vs/a.ts");
    });

    it("gives null outside it", () => {
        expect(relativeIn("/home/a/Repo", "/home/a/repo/x.ts", "linux")).toBeNull();
        expect(relativeIn("/a/repo", "/a/repo2/x.ts", "linux")).toBeNull();
        expect(relativeIn("/a/repo", "/a/repo", "linux")).toBeNull();              // the root is not a file
    });
});

describe("uriPathOf and upperCaseDrive", () => {
    it("gives a file URI's path", () => {
        expect(uriPathOf("C:/x/y")).toBe("/C:/x/y");
        expect(uriPathOf("/home/x")).toBe("/home/x");
    });

    it("upper-cases a Windows drive letter only (P15)", () => {
        expect(upperCaseDrive("c:\\Users\\Ann Lee\\mini repo", "win32")).toBe("C:\\Users\\Ann Lee\\mini repo");
        expect(upperCaseDrive("/home/c:x", "linux")).toBe("/home/c:x");
    });
});

describe("checkRepoPath (an open from the Map, P17 and Review Focus 4)", () => {
    it("keeps a repo-relative path, in the stored spelling", () => {
        expect(checkRepoPath("src/app/main.ts")).toBe("src/app/main.ts");
        expect(checkRepoPath("./src//a.ts")).toBe("src/a.ts");
        expect(checkRepoPath("src\\a.ts")).toBe("src/a.ts");
    });

    it("refuses anything that could name a place outside the repo, or nothing", () => {
        for (const raw of ["../outside.ts", "src/../../x", "/etc/passwd", "C:/x", "a\u0000b", "", "."]) expect({ raw, checked: checkRepoPath(raw) }).toEqual({ raw, checked: null });
    });

    it("takes at most 1,024 characters", () => {
        const longest = `src/${"a".repeat(1_017)}.ts`;
        expect(longest).toHaveLength(1_024);
        expect(checkRepoPath(longest)).toBe(longest);
        expect(checkRepoPath(`${longest}x`)).toBeNull();
    });
});
