import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { assembleChunks, type Declaration } from "./chunking";

// Every value below is worked out by hand from lib/chunks.ts's rules (ADR-018/019/020): whole lines, ids made unique
// with ~n, parts of 200 lines overlapping by 3, and the file summary's text format.

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Twelve lines: a function at 1–3, a blank line, a class at 5–12. */
const TWELVE = [
    "def f():", "    x = 1", "    return x", "",
    "class C:", "    a = 1", "    b = 2", "    c = 3", "    d = 4", "    e = 5", "    g = 6", "    h = 7",
];
const TWELVE_TEXT = `${TWELVE.join("\n")}\n`;
const DECLS: Declaration[] = [
    { kind: "function", name: "f", startLine: 1, endLine: 3, exported: true },
    { kind: "class", name: "C", startLine: 5, endLine: 12, exported: false },
];

describe("assembleChunks", () => {
    it("gives each declaration its whole lines, then the file summary over every line", () => {
        const chunks = assembleChunks("a.py", TWELVE_TEXT, DECLS, { imports: ["import os"], exports: ["f (function)"] });
        const fileHash = sha(TWELVE_TEXT);
        expect(chunks).toEqual([
            { id: "a.py#f#0", filePath: "a.py", kind: "function", name: "f", startLine: 1, endLine: 3, exported: true, partIndex: 0, text: "def f():\n    x = 1\n    return x", fileHash },
            { id: "a.py#C#0", filePath: "a.py", kind: "class", name: "C", startLine: 5, endLine: 12, exported: false, partIndex: 0, text: TWELVE.slice(4).join("\n"), fileHash },
            {
                id: "a.py#(file)#0", filePath: "a.py", kind: "file-summary", name: "(file)", startLine: 1, endLine: 12, exported: false, partIndex: 0,
                text: "File: a.py\n\nImports:\nimport os\n\nExports:\nf (function)", fileHash,
            },
        ]);
    });

    it("makes ids unique when two declarations share a name", () => {
        const decls: Declaration[] = [
            { kind: "function", name: "f", startLine: 1, endLine: 1, exported: true },
            { kind: "function", name: "f", startLine: 3, endLine: 3, exported: true },
        ];
        const chunks = assembleChunks("a.py", "def f(): pass\n\ndef f(): pass\n", decls, { imports: [], exports: [] });
        expect(chunks.map((c) => c.id)).toEqual(["a.py#f#0", "a.py#f~2#0", "a.py#(file)#0"]);
        expect(chunks.map((c) => c.name)).toEqual(["f", "f", "(file)"]);
    });

    it("splits a 450-line declaration into parts at 1–200, 198–397 and 395–450", () => {
        const lines = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`);
        const chunks = assembleChunks("a.py", `${lines.join("\n")}\n`, [{ kind: "function", name: "big", startLine: 1, endLine: 450, exported: false }], { imports: [], exports: [] });
        expect(chunks.map((c) => [c.id, c.partIndex, c.startLine, c.endLine])).toEqual([
            ["a.py#big#0", 0, 1, 200],
            ["a.py#big#1", 1, 198, 397],
            ["a.py#big#2", 2, 395, 450],
            ["a.py#(file)#0", 0, 1, 450],
        ]);
        expect(chunks[1].text).toBe(lines.slice(197, 397).join("\n"));
        expect(chunks[2].text).toBe(lines.slice(394).join("\n"));
    });

    it("gives an empty text only the summary, at line 1, with nothing to list", () => {
        expect(assembleChunks("a.py", "", [], { imports: [], exports: [] })).toEqual([{
            id: "a.py#(file)#0", filePath: "a.py", kind: "file-summary", name: "(file)", startLine: 1, endLine: 1, exported: false, partIndex: 0,
            text: "File: a.py\n\nImports:\n  (none)\n\nExports:\n  (none)", fileHash: sha(""),
        }]);
    });

    it("gives a text with a leading byte-order mark the same chunks as without it", () => {
        const bom = String.fromCharCode(0xfeff);
        const summary = { imports: ["import os"], exports: ["f (function)"] };
        expect(assembleChunks("a.py", `${bom}${TWELVE_TEXT}`, DECLS, summary)).toEqual(assembleChunks("a.py", TWELVE_TEXT, DECLS, summary));
    });

    it("reads a CRLF text's lines without their line endings, so its chunks' text is the LF text's", () => {
        const crlf = TWELVE_TEXT.replace(/\n/g, "\r\n");
        const summary = { imports: [], exports: [] };
        const lf = assembleChunks("a.py", TWELVE_TEXT, DECLS, summary);
        const fromCrlf = assembleChunks("a.py", crlf, DECLS, summary);
        expect(fromCrlf.map((c) => c.text)).toEqual(lf.map((c) => c.text));
        expect(fromCrlf.map((c) => [c.startLine, c.endLine])).toEqual(lf.map((c) => [c.startLine, c.endLine]));
        expect(fromCrlf[0].fileHash).toBe(sha(crlf));   // the hash is of the bytes as they are
    });
});
