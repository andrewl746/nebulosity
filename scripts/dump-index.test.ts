import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../test/helpers/fixture";
import { getDb } from "../lib/db/client";
import { indexRepository } from "../lib/index/pipeline";
import { dumpIndex, DUMP_SECTIONS, summarizeDump } from "./dump-index";

/**
 * Every expectation is the mini-repo's ground truth, derived by hand (docs/plans/2026-10-11-v1-1-engine-foundation.md,
 * "Fixture ground truth", and the fixture's own files read line by line): its 8 files and line counts, the specifiers
 * each file writes in source order, the 11 edges, the symbols, and the chunks (one per top-level declaration plus the
 * file summary). Content hashes and chunk texts are taken from the fixture's bytes on disk, so a CRLF checkout agrees.
 */

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Lines start..end of a fixture file as a declaration's chunk holds them: no line ending after the last. */
function linesOf(root: string, rel: string, start: number, end: number): string {
    const text = fs.readFileSync(path.join(root, rel), "utf8").split("\n").slice(start - 1, end).join("\n");
    return text.endsWith("\r") ? text.slice(0, -1) : text;
}

const FILES: [path: string, language: string, isTest: boolean, lineCount: number, specifiers: string[]][] = [
    ["scripts/build.js", "javascript", false, 3, ["../src/index", "../src/app/main"]],
    ["src/app/main.ts", "typescript", false, 8, ["../core/log", "./view", "../util/strings.js"]],
    ["src/app/view.tsx", "typescript", false, 11, ["react", "./main"]],
    ["src/core/index.ts", "typescript", false, 1, ["./log"]],
    ["src/core/log.ts", "typescript", false, 9, []],
    ["src/index.ts", "typescript", false, 7, ["./app/main", "@core/log"]],
    ["src/util/strings.test.ts", "typescript", true, 3, ["./strings"]],
    ["src/util/strings.ts", "typescript", false, 6, ["../core"]],
];

// the V1.1 plan's 11 edges, sorted by source then target
const EDGES = [
    "edge\tscripts/build.js\tsrc/app/main.ts\t../src/app/main",
    "edge\tscripts/build.js\tsrc/index.ts\t../src/index",
    "edge\tsrc/app/main.ts\tsrc/app/view.tsx\t./view",
    "edge\tsrc/app/main.ts\tsrc/core/log.ts\t../core/log",
    "edge\tsrc/app/main.ts\tsrc/util/strings.ts\t../util/strings.js",
    "edge\tsrc/app/view.tsx\tsrc/app/main.ts\t./main",
    "edge\tsrc/core/index.ts\tsrc/core/log.ts\t./log",
    "edge\tsrc/index.ts\tsrc/app/main.ts\t./app/main",
    "edge\tsrc/index.ts\tsrc/core/log.ts\t@core/log",
    "edge\tsrc/util/strings.test.ts\tsrc/util/strings.ts\t./strings",
    "edge\tsrc/util/strings.ts\tsrc/core/index.ts\t../core",
];

// log.ts from the V1.1 plan's table; the others read from the files (a top-level function, class, or variable)
const SYMBOLS = [
    "symbol\tsrc/app/main.ts\tmain\tfunction\t5\t8\ttrue",
    "symbol\tsrc/app/view.tsx\tView\tfunction\t9\t11\ttrue",
    "symbol\tsrc/app/view.tsx\trender\tfunction\t4\t7\ttrue",
    "symbol\tsrc/core/log.ts\tLogger\tclass\t4\t7\ttrue",
    "symbol\tsrc/core/log.ts\tLogger.info\tmethod\t5\t5\ttrue",
    "symbol\tsrc/core/log.ts\tLogger.warn\tmethod\t6\t6\tfalse",
    "symbol\tsrc/core/log.ts\tbanner\tconst\t9\t9\ttrue",
    "symbol\tsrc/core/log.ts\tlog\tfunction\t2\t2\ttrue",
    "symbol\tsrc/index.ts\tstart\tfunction\t4\t7\ttrue",
    "symbol\tsrc/util/strings.test.ts\tchecks\tconst\t3\t3\ttrue",
    "symbol\tsrc/util/strings.ts\tshout\tfunction\t3\t6\ttrue",
];

describe("dump-index", () => {
    it("dumps the mini-repo's files, edges, symbols, chunks and entry points as sorted tab-separated lines", () => {
        const root = copyFixture();
        const { repoId } = indexRepository(root);
        const dump = dumpIndex(getDb(), repoId);

        const fileHash = (rel: string): string => sha(fs.readFileSync(path.join(root, rel), "utf8"));
        expect(dump.file).toEqual(FILES.map(([p, language, isTest, lineCount, specifiers]) =>
            ["file", p, language, String(isTest), String(lineCount), fileHash(p), JSON.stringify(specifiers), "[]"].join("\t")));
        expect(dump.edge).toEqual(EDGES);
        expect(dump.symbol).toEqual(SYMBOLS);
        expect(dump.entry).toEqual([]);   // no package.json names anything

        // one chunk per top-level declaration plus the file summary: 2 + 2 + 3 + 1 + 4 + 2 + 2 + 2
        expect(dump.chunk).toHaveLength(18);
        const logSummary = "File: src/core/log.ts\n\nImports:\n  (none)\n\nExports:\nlog (function)\nLogger (class)\nbanner (const)";
        expect(dump.chunk.filter((l) => l.startsWith("chunk\tsrc/core/log.ts\t"))).toEqual([
            `chunk\tsrc/core/log.ts\tsrc/core/log.ts#(file)#0\t1\t9\t${sha(logSummary)}`,
            `chunk\tsrc/core/log.ts\tsrc/core/log.ts#Logger#0\t4\t7\t${sha(linesOf(root, "src/core/log.ts", 4, 7))}`,
            `chunk\tsrc/core/log.ts\tsrc/core/log.ts#banner#0\t9\t9\t${sha(linesOf(root, "src/core/log.ts", 9, 9))}`,
            `chunk\tsrc/core/log.ts\tsrc/core/log.ts#log#0\t1\t2\t${sha(linesOf(root, "src/core/log.ts", 1, 2))}`,
        ]);
        expect(dump.chunk.filter((l) => l.startsWith("chunk\tsrc/core/index.ts\t"))).toEqual([
            `chunk\tsrc/core/index.ts\tsrc/core/index.ts#(file)#0\t1\t1\t${sha("File: src/core/index.ts\n\nImports:\n  (none)\n\nExports:\nexport * from \"./log\";")}`,
        ]);
    });

    it("counts and hashes each section, in the order file, edge, symbol, chunk, entry", () => {
        const { repoId } = indexRepository(copyFixture());
        const dump = dumpIndex(getDb(), repoId);
        const summary = summarizeDump(dump);

        expect(summary.map((s) => s.section)).toEqual([...DUMP_SECTIONS]);
        expect(summary.map((s) => s.count)).toEqual([8, 11, 11, 18, 0]);
        expect(summary.find((s) => s.section === "edge")?.sha256).toBe(sha(EDGES.map((l) => `${l}\n`).join("")));
        expect(summary.find((s) => s.section === "entry")?.sha256).toBe(sha(""));
    });

    it("keeps only the files of the languages asked for, and only the edges whose ends both are", () => {
        const { repoId } = indexRepository(copyFixture());
        const dump = dumpIndex(getDb(), repoId, { languages: ["javascript"] });

        expect(dump.file.map((l) => l.split("\t")[1])).toEqual(["scripts/build.js"]);
        expect(dump.edge).toEqual([]);   // both of build.js's edges end in a TypeScript file
        expect(dump.symbol).toEqual([]);   // `const { start } = require(…)` destructures: no single name
        expect(dump.chunk.map((l) => l.split("\t")[2])).toEqual(["scripts/build.js#(file)#0", "scripts/build.js#{ start }#0"]);
        expect(dump.entry).toEqual([]);

        const both = dumpIndex(getDb(), repoId, { languages: ["typescript", "javascript"] });
        expect(both).toEqual(dumpIndex(getDb(), repoId));
    });
});
