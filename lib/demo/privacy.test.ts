import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { makeTempDir } from "../../test/helpers/temp";
import { findLeak, leakNeedles, scanForLeaks, slug, spellings } from "./privacy";

describe("spellings", () => {
    it("covers slashes either way, JSON-escaped, URL-encoded and Git Bash's form, lowercased", () => {
        const forms = ["c:/users/ann", "c:\\users\\ann", "c:\\\\users\\\\ann", "c%3a%2fusers%2fann", "c%3a%5cusers%5cann", "/c/users/ann"];
        expect(spellings("C:/Users/Ann")).toEqual(forms);
        expect(spellings("C:\\Users\\Ann\\")).toEqual(forms);
        expect(spellings("/home/ann")).toEqual(["/home/ann", "\\home\\ann", "\\\\home\\\\ann", "%2fhome%2fann", "%5chome%5cann"]);
    });

    it("refuses a folder too shallow to scan for", () => {
        expect(() => spellings("C:/")).toThrow(/too shallow/);
        expect(() => spellings("/")).toThrow(/too shallow/);
    });
});

describe("slug", () => {
    it("is the folder with every character that isn't a letter or a digit turned into a dash: how Claude Code names a project's folder", () => {
        expect(slug("C:/Users/Ann")).toBe("C--Users-Ann");
        expect(slug("C:\\Users\\Ann\\")).toBe("C--Users-Ann");
        expect(slug("/home/ann")).toBe("-home-ann");
        expect(slug("C:/Users/Ann/my.code_1")).toBe("C--Users-Ann-my-code-1");
    });

    it("is one of a folder's leak needles, lowercased, because a transcript names ~/.claude/projects/<slug>/", () => {
        const needles = leakNeedles({ folders: ["C:/Users/Ann"] });
        expect(needles).toContain("c--users-ann");
        expect(findLeak("projects\\C--Users-Ann-code\\memory", needles)).toBe("c--users-ann");
        expect(findLeak("projects/C--Users-Bob/memory", needles)).toBeNull();
    });
});

describe("findLeak", () => {
    const needles = leakNeedles({ folders: ["C:/Users/Ann"], email: "Ann@Example.com" });

    it("finds a folder in any spelling, and the email, ignoring case", () => {
        // a JSON file holds backslashes doubled: {"repo":"C:\\Users\\Ann\\code"}
        expect(findLeak('{"repo":"C:\\\\Users\\\\Ann\\\\code"}', needles)).toBe("c:\\\\users\\\\ann");
        expect(findLeak("cwd /c/users/ANN/vscode", needles)).toBe("/c/users/ann");
        expect(findLeak("C%3A%2FUsers%2FAnn%2Fx", needles)).toBe("c%3a%2fusers%2fann");
        expect(findLeak("mail ann@example.com", needles)).toBe("ann@example.com");
        expect(findLeak("nothing here: src/vs/base", needles)).toBeNull();
    });

    it("finds a path escaped twice or more, with mixed slashes, or with a partly encoded drive", () => {
        // JSON inside JSON, as in a stream-json transcript whose tool_result holds JSON text. The inner string is
        // {"root":"C:\\Users\\Ann\\x"} (two backslashes); stringifying it again doubles each one, so "C:" is
        // followed by four.
        const nested = JSON.stringify({ content: JSON.stringify({ root: "C:\\Users\\Ann\\x" }) });
        expect(nested).toContain("C:" + "\\".repeat(4) + "Users");
        // the report names a needle exactly as leakNeedles produced it, never its folded form
        expect(needles).toContain(findLeak(nested, needles));
        for (const n of [3, 4, 8]) {
            expect(findLeak("C:" + "\\".repeat(n) + "Users" + "\\".repeat(n) + "Ann", needles)).not.toBeNull();
        }
        expect(findLeak("C:\\Users/Ann/x", needles)).not.toBeNull(); // runtime: C:\Users/Ann/x
        expect(findLeak("C:/Users\\Ann\\x", needles)).not.toBeNull(); // runtime: C:/Users\Ann\x
        expect(findLeak("file:///c%3A/Users/Ann/x", needles)).not.toBeNull();
        expect(findLeak("C%3A/Users/Ann", needles)).not.toBeNull();
        expect(findLeak("ann%40example.com", needles)).not.toBeNull();
    });

    it("matches a folder whose name is the start of a longer one, by design", () => {
        // "c:/users/ann" is a substring of "c:/users/annabel/x". A leak scanner errs towards reporting, so there is no
        // check that the match ends at a path segment.
        expect(findLeak("C:/Users/Annabel/x", needles)).toBe("c:/users/ann");
    });

    it("ignores case in the needles too, and returns a needle as it was given", () => {
        expect(findLeak("xABCx", ["ABC"])).toBe("ABC");
    });
});

describe("a path cut off at its front (final review, B-I1)", () => {
    // a model's script printed path.slice(n) of an absolute path: "ers/Ann/Programming/…", which holds no whole folder
    const cut = "ers/Ann/Programming/vscode/src/vs/base/browser/animatedValue.ts";
    const folders = ["C:/Users/Ann/Programming/Nebulosity", "C:/Users/Ann/Programming/vscode", "D:/work/affine"];

    it("is missed by the whole-folder needles alone", () => {
        expect(findLeak(cut, leakNeedles({ folders: ["C:/Users/Ann", ...folders] }))).toBeNull();
    });

    it("is found by the home's user-name segment and the next one, in any spelling, once the home folder is given", () => {
        const needles = leakNeedles({ folders, home: "C:\\Users\\Ann" });
        // one pair for both folders inside the home; D:/work/affine is outside it and adds none
        expect(needles.filter((n) => n.startsWith("ann/"))).toEqual(["ann/programming"]);
        // the home's own spellings come with it, as if it were one of the folders
        expect(needles).toContain("c:/users/ann");
        expect(findLeak(cut, needles)).toBe("ann/programming");
        expect(findLeak("s\\Ann\\Programming\\vscode\\x.ts", needles)).toBe("ann/programming");   // runtime: s\Ann\Programming\vscode\x.ts
        expect(findLeak('{"p":"rs\\\\ANN\\\\programming\\\\y"}', needles)).toBe("ann/programming");   // JSON-escaped, any case
        expect(findLeak("ers%2FAnn%2FProgramming%2Fz", needles)).toBe("ann/programming");
        // another user's path, or the same words apart, is no leak
        expect(findLeak("/Users/jrieken/Code/vscode/src/x.ts", needles)).toBeNull();
        expect(findLeak("Ann wrote the Programming guide", needles)).toBeNull();
    });

    it("adds no pair for the home itself or a folder outside it", () => {
        const needles = leakNeedles({ folders: ["C:/Users/Ann", "D:/work/affine"], home: "C:/Users/Ann" });
        expect(findLeak("ers/Ann/Desktop/notes.txt", needles)).toBeNull();
        expect(needles.some((n) => n.startsWith("ann/"))).toBe(false);
    });
});

describe("scanForLeaks", () => {
    it("names every file under a folder that holds a needle", () => {
        const dir = makeTempDir("neb-leaks-");
        fs.mkdirSync(path.join(dir, "sub"));
        fs.writeFileSync(path.join(dir, "a.json"), '{"repo":"vscode"}');
        fs.writeFileSync(path.join(dir, "sub", "b.js"), 'const root = "C:/users/ann/x";');
        expect(scanForLeaks(dir, leakNeedles({ folders: ["C:/Users/Ann"] }))).toEqual([{ file: "sub/b.js", needle: "c:/users/ann" }]);
    });

    it("finds a path in a UTF-16 file, little or big endian, with a BOM or without (PowerShell 5.1's > writes one)", () => {
        const dir = makeTempDir("neb-leaks-");
        const le = Buffer.from("root C:/Users/Ann/x", "utf16le");
        // Node has no big-endian encoding: swap each pair of bytes of the little-endian form
        const be = Buffer.from(le).swap16();
        fs.writeFileSync(path.join(dir, "a-le.txt"), le);
        fs.writeFileSync(path.join(dir, "b-le-bom.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), le]));
        fs.writeFileSync(path.join(dir, "c-be-bom.txt"), Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
        fs.writeFileSync(path.join(dir, "d-clean-le.txt"), Buffer.from("root src/vs/base", "utf16le"));
        expect(scanForLeaks(dir, leakNeedles({ folders: ["C:/Users/Ann"] }))).toEqual([
            { file: "a-le.txt", needle: "c:/users/ann" },
            { file: "b-le-bom.txt", needle: "c:/users/ann" },
            { file: "c-be-bom.txt", needle: "c:/users/ann" },
        ]);
    });

    it("refuses to scan for nothing, which would call every folder clean", () => {
        const dir = makeTempDir("neb-leaks-");
        expect(() => scanForLeaks(dir, [])).toThrow(/nothing to scan for/);
    });
});
