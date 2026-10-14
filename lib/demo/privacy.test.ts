import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { makeTempDir } from "../../test/helpers/temp";
import { findLeak, leakNeedles, scanForLeaks, spellings } from "./privacy";

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
});

describe("scanForLeaks", () => {
    it("names every file under a folder that holds a needle", () => {
        const dir = makeTempDir("neb-leaks-");
        fs.mkdirSync(path.join(dir, "sub"));
        fs.writeFileSync(path.join(dir, "a.json"), '{"repo":"vscode"}');
        fs.writeFileSync(path.join(dir, "sub", "b.js"), 'const root = "C:/users/ann/x";');
        expect(scanForLeaks(dir, leakNeedles({ folders: ["C:/Users/Ann"] }))).toEqual([{ file: "sub/b.js", needle: "c:/users/ann" }]);
    });
});
