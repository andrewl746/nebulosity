import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { grammarPath } from "./treesitter";

/**
 * The committed grammars (scripts/copy-grammars.mjs): each listed grammar is there as `<file>.gz`, decompresses to the
 * bytes its sha256 names, and equals its package's own file. Compressed bytes are never compared: gzip's output can
 * differ by zlib version and system, its content can't.
 */
const GRAMMARS = path.resolve("lib/index/languages/grammars");
type Entry = { id: string; package: string; version: string; file: string; sha256: string };
const entries = JSON.parse(fs.readFileSync(path.join(GRAMMARS, "grammars.json"), "utf8")) as Entry[];
const unpacked = (entry: Entry) => zlib.gunzipSync(fs.readFileSync(path.join(GRAMMARS, `${entry.file}.gz`)));

describe("the committed grammars", () => {
    it("lists the five grammars by id", () => {
        expect(entries.map((e) => e.id)).toEqual(["python", "go", "java", "csharp", "rust"]);
    });

    it("holds each grammar only compressed, beside grammars.json and NOTICE.md", () => {
        expect(fs.readdirSync(GRAMMARS).sort()).toEqual(["NOTICE.md", "grammars.json", ...entries.map((e) => `${e.file}.gz`)].sort());
    });

    it("is where the loader reads it", () => {
        for (const entry of entries) expect(grammarPath(entry.file)).toBe(path.join(GRAMMARS, `${entry.file}.gz`));
    });

    it.each(entries)("$file.gz decompresses to WebAssembly hashing to its sha256", (entry) => {
        const bytes = unpacked(entry);
        expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);   // "\0asm", WebAssembly's magic number
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    });

    it.each(entries)("$file.gz decompresses to $package's own file, when the package is installed", (entry) => {
        const source = path.resolve("node_modules", entry.package, entry.file);
        if (!fs.existsSync(path.resolve("node_modules", entry.package))) return;   // an installed copy has no devDependencies
        const installed = JSON.parse(fs.readFileSync(path.resolve("node_modules", entry.package, "package.json"), "utf8")) as { version: string };
        expect(installed.version).toBe(entry.version);
        expect(unpacked(entry).equals(fs.readFileSync(source))).toBe(true);
    });

    it("says in NOTICE.md that the files are compressed and otherwise unchanged", () => {
        const notice = fs.readFileSync(path.join(GRAMMARS, "NOTICE.md"), "utf8");
        expect(notice).toContain("gzip-compressed and otherwise");
        for (const entry of entries) expect(notice).toContain(`\`${entry.file}.gz\``);
    });
});
