import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/** The committed grammars (scripts/copy-grammars.mjs): each listed file is there, unchanged, and equal to its package's. */
const GRAMMARS = path.resolve("lib/index/languages/grammars");
type Entry = { id: string; package: string; version: string; file: string; sha256: string };
const entries = JSON.parse(fs.readFileSync(path.join(GRAMMARS, "grammars.json"), "utf8")) as Entry[];

describe("the committed grammars", () => {
    it("lists the five grammars by id", () => {
        expect(entries.map((e) => e.id)).toEqual(["python", "go", "java", "csharp", "rust"]);
    });

    it.each(entries)("$file exists and hashes to its sha256", (entry) => {
        const bytes = fs.readFileSync(path.join(GRAMMARS, entry.file));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    });

    it.each(entries)("$file is byte-equal to $package's own, when the package is installed", (entry) => {
        const source = path.resolve("node_modules", entry.package, entry.file);
        if (!fs.existsSync(path.resolve("node_modules", entry.package))) return;   // an installed copy has no devDependencies
        const installed = JSON.parse(fs.readFileSync(path.resolve("node_modules", entry.package, "package.json"), "utf8")) as { version: string };
        expect(installed.version).toBe(entry.version);
        expect(fs.readFileSync(path.join(GRAMMARS, entry.file)).equals(fs.readFileSync(source))).toBe(true);
    });
});
