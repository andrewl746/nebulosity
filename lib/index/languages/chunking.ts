/**
 * Chunks for the tree-sitter adapters (ADR-065), with lib/chunks.ts's invariants (ADR-018/019/020): one chunk per
 * top-level declaration whose line range and text are the same whole lines, then a file-summary chunk in TypeScript's
 * exact text format, ids made unique within the file, and declarations over 200 lines split into overlapping parts.
 * The adapter decides what a declaration is and where it starts (its attached comments and decorators, leadingSpan);
 * this module only cuts the lines and assembles the chunks, so every language's chunks read alike.
 */
import { createHash } from "crypto";
import { disambiguateIds, splitOversizedChunks } from "../../chunks";
import type { ChunkKind, CodeChunk } from "../../contracts";
import { countLines } from "./typescript";
import { withoutBom } from "./treesitter";

/** One top-level declaration, as an adapter found it: lines are 1-based and inclusive. */
export type Declaration = { kind: ChunkKind; name: string; startLine: number; endLine: number; exported: boolean };

/**
 * A file's chunks: each declaration (in the order given) as its whole lines startLine..endLine joined by "\n", then the
 * file summary over lines 1..max(1, line count). The summary lists `imports` (each import statement's text, one per
 * line) and `exports` (lines that read `<name> (<kind>)`), "  (none)" for an empty list. One leading U+FEFF is dropped
 * first. A line is read without its ending ("\r\n" or "\n"), so a CRLF checkout's chunks hold the same text as an LF
 * checkout's; fileHash is the sha256 hex of the text as given (the BOM dropped).
 */
export function assembleChunks(
    filePath: string, text: string, declarations: readonly Declaration[], summary: { imports: readonly string[]; exports: readonly string[] }
): CodeChunk[] {
    const body = withoutBom(text);
    const fileHash = createHash("sha256").update(body).digest("hex");
    const lines = body.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

    const chunks: CodeChunk[] = declarations.map((d) => ({
        id: `${filePath}#${d.name}#0`,   // finalized by disambiguateIds and splitOversizedChunks
        filePath,
        kind: d.kind,
        name: d.name,
        startLine: d.startLine,
        endLine: d.endLine,
        exported: d.exported,
        partIndex: 0,
        text: lines.slice(d.startLine - 1, d.endLine).join("\n"),
        fileHash,
    }));

    chunks.push({
        id: `${filePath}#(file)#0`,
        filePath,
        kind: "file-summary",
        name: "(file)",
        startLine: 1,
        endLine: Math.max(1, countLines(body)),
        exported: false,
        partIndex: 0,
        text: [
            `File: ${filePath}`,
            "",
            "Imports:",
            summary.imports.length > 0 ? summary.imports.join("\n") : "  (none)",
            "",
            "Exports:",
            summary.exports.length > 0 ? summary.exports.join("\n") : "  (none)",
        ].join("\n"),
        fileHash,
    });

    // order matters: ids must be final before the splitter derives part ids from them
    return splitOversizedChunks(disambiguateIds(chunks));
}
