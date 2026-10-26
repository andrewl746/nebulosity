import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { pythonAdapter } from "../index/languages/python";
import { prepareLanguages } from "../index/languages/registry";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { PathNotFoundError } from "./level";
import { cutAtCharacter, insideRoot, readSource } from "./source";

describe("readSource (owner review: view a file's source on the Map)", () => {
    it("returns an indexed file's text, its lines and its language", () => {
        const root = copyFixture();
        indexRepository(root);
        const source = readSource(root, "src/core/log.ts");
        // the fixture's log.ts: 9 lines (V1.2 ground truth), starting with its doc comment
        expect(source).toMatchObject({ repo: repoKey(root), path: "src/core/log.ts", lineCount: 9, truncated: false, language: "typescript" });
        expect(source.content.split(/\r?\n/)[0]).toBe("/** Writes a message. */");
        expect(source.content).toContain("export class Logger {");
    });

    it("names an E4 language's file by the rules that read it (C10): a .py file is python", async () => {
        await prepareLanguages([pythonAdapter]);
        const root = copyFixture();
        fs.writeFileSync(path.join(root, "scripts.py"), "import os\n\nprint(os.getcwd())\n");
        indexRepository(root);
        expect(readSource(root, "scripts.py")).toMatchObject({ path: "scripts.py", lineCount: 3, truncated: false, language: "python" });
    });

    it("cuts a file past the size limit and says so", () => {
        const root = copyFixture();
        indexRepository(root);
        const source = readSource(root, "src/core/log.ts", { maxBytes: 10 });
        expect(source.truncated).toBe(true);
        expect(source.content).toBe("/** Writes");
    });

    it("never cuts a character in two (deferred minor: the cut could split a UTF-8 sequence)", () => {
        const root = copyFixture();
        // "// é": the bytes 2F 2F 20 C3 A9 ...; a 4-byte cut falls between C3 and A9, so it backs off to "// "
        fs.writeFileSync(path.join(root, "src/core/accents.ts"), "// é\nexport const accent = 1;\n");
        indexRepository(root);
        const source = readSource(root, "src/core/accents.ts", { maxBytes: 4 });
        expect(source).toMatchObject({ content: "// ", truncated: true });
    });

    it("shows only files the index knows: not a folder, a missing file, or a file it didn't index", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(() => readSource(root, "src/core")).toThrow(PathNotFoundError);
        expect(() => readSource(root, "src/nope.ts")).toThrow(PathNotFoundError);
        expect(() => readSource(root, "README.md")).toThrow(PathNotFoundError);
    });
});

describe("insideRoot", () => {
    it("keeps a resolved file inside the repo: a symlink can't lead the viewer out", () => {
        const root = path.resolve("/repos/r");
        expect(insideRoot(path.join(root, "src", "a.ts"), root)).toBe(true);
        expect(insideRoot(path.resolve("/repos/r2/a.ts"), root)).toBe(false);
        expect(insideRoot(path.resolve("/repos/a.ts"), root)).toBe(false);
        expect(insideRoot(root, root)).toBe(false);
    });
});

describe("cutAtCharacter: how many bytes to keep so a cut never splits a UTF-8 character", () => {
    it("keeps everything that fits", () => {
        expect(cutAtCharacter(Buffer.from("aé"), 3)).toBe(3);         // 61 C3 A9: 3 bytes
        expect(cutAtCharacter(Buffer.from("abc"), 10)).toBe(3);
    });

    it("backs off to the start of a character the cut would split", () => {
        expect(cutAtCharacter(Buffer.from("aé"), 2)).toBe(1);         // the cut lands on A9, é's second byte: keep "a"
        // 😀 is F0 9F 98 80: a cut after 4 bytes lands on 80, then 98 and 9F are continuations too, F0 starts it
        expect(cutAtCharacter(Buffer.from("a😀b"), 4)).toBe(1);
        expect(cutAtCharacter(Buffer.from("a😀b"), 5)).toBe(5);       // the cut lands on "b": "a😀" is whole
    });

    it("cuts plain ASCII exactly where asked", () => {
        expect(cutAtCharacter(Buffer.from("/** Writes a message. */"), 10)).toBe(10);
    });
});
