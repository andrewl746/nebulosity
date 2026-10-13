import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { repoKey } from "../index/paths";
import { indexRepository } from "../index/pipeline";
import { PathNotFoundError } from "./level";
import { insideRoot, readSource } from "./source";

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

    it("cuts a file past the size limit and says so", () => {
        const root = copyFixture();
        indexRepository(root);
        const source = readSource(root, "src/core/log.ts", { maxBytes: 10 });
        expect(source.truncated).toBe(true);
        expect(source.content).toBe("/** Writes");
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
