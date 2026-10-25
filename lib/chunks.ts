/**
 * lib/chunks.ts — AST chunker (Phase 2, Task 1)
 *
 * Splits a source file into retrievable units using the TypeScript Compiler
 * API. One chunk per top-level declaration, plus a synthetic file-summary
 * chunk listing the file's imports and exports.
 *
 * Two invariants worth holding onto while reading:
 *
 *  1. `startLine`, `endLine` and `text` always describe the SAME region — the
 *     declaration together with its attached leading comment block (ADR-018).
 *     Retrieval needs the doc comment; the UI needs line numbers that open to
 *     the right place. Both are satisfied by picking one span and using it for
 *     everything.
 *  2. Ids are unique within a file even when names repeat (ADR-019).
 *
 * See docs/RAG_PIPELINE.md §2–3 for the design, and
 * docs/RAG_IMPLEMENTATION_REVIEW.md for the bugs this replaced.
 */

import ts from "typescript";
import crypto from "crypto";
import type { ChunkKind, CodeChunk } from "./contracts";

const MAX_CHUNK_LINES = 200;
const OVERLAP_LINES = 3;

// parse the file into a TypeScript AST (script kind — TS, TSX, JS, JSX — comes from the extension)
export function parseSourceFile(filePath: string, fileText: string): ts.SourceFile {
    return ts.createSourceFile(
        filePath,
        fileText,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
    );
}

export function extractChunksFromFile(filePath: string, fileText: string): CodeChunk[] {
    return extractChunksFromSourceFile(filePath, parseSourceFile(filePath, fileText));
}

/**
 * The same as extractChunksFromFile, for a caller that has already parsed the file.
 * The indexer parses each file exactly once and derives chunks, symbols and imports
 * from that single AST, because parsing is the expensive part (PIVOT_SPEC.md §1).
 */
export function extractChunksFromSourceFile(filePath: string, sourceFileAST: ts.SourceFile): CodeChunk[] {
    const fileHash = crypto.createHash("sha256").update(sourceFileAST.text).digest("hex");
    const chunks: CodeChunk[] = [];

    // walk through each top level statement
    for (const statement of sourceFileAST.statements){
        const chunk = processStatement(statement, sourceFileAST, filePath, fileHash);

        if (chunk){
            chunks.push(chunk);
        }
    }

    // add file summary chunk
    chunks.push(createFileSummaryChunk(filePath, sourceFileAST, fileHash));

    // order matters: ids must be final before the splitter derives part ids from them
    return splitOversizedChunks(disambiguateIds(chunks));
}

/**
 * Where a chunk starts and ends in the source text.
 *
 * A chunk is the declaration PLUS its attached leading comment block. Each of
 * the two obvious primitives gets exactly half of that right:
 *
 *   - `node.getStart()`     skips the doc comment, which retrieval depends on
 *   - `node.getFullStart()` swallows blank lines and any *detached* comment
 *                           sitting above them
 *
 * So we walk the leading comment ranges backwards and keep only those separated
 * from what follows by at most a single line break — a blank line means the
 * comment belongs to whatever came before, not to this declaration.
 */
function chunkSpan(node: ts.Node, sourceFile: ts.SourceFile): { start: number; end: number } {
    const end = node.getEnd();
    const declarationStart = node.getStart(sourceFile);
    const commentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart());

    if (!commentRanges || commentRanges.length === 0){
        return { start: declarationStart, end };
    }

    let start = declarationStart;

    for (let i = commentRanges.length - 1; i >= 0; i--){
        const gap = sourceFile.text.slice(commentRanges[i].end, start);

        // more than one line break means there is a blank line between this
        // comment and what follows it — the comment is detached, so stop
        if (countLineBreaks(gap) > 1){
            break;
        }

        start = commentRanges[i].pos;
    }

    return { start, end };
}

function countLineBreaks(text: string): number {
    let count = 0;

    for (const char of text){
        if (char === "\n") count++;
    }

    return count;
}

/** Builds a chunk from one node, using a single span for text and line range. */
function makeChunk(options: {
    node: ts.Node;
    sourceFile: ts.SourceFile;
    filePath: string;
    fileHash: string;
    kind: ChunkKind;
    name: string;
    exported: boolean;
}): CodeChunk {
    const { node, sourceFile, filePath, fileHash, kind, name, exported } = options;
    const { start, end } = chunkSpan(node, sourceFile);

    return {
        id: `${filePath}#${name}#0`, // finalized by disambiguateIds / splitOversizedChunks
        filePath,
        kind,
        name,
        startLine: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(end).line + 1,
        exported,
        partIndex: 0,
        text: sourceFile.text.slice(start, end),
        fileHash
    };
}

function processStatement(
    node: ts.Statement,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    const common = { node, sourceFile: sourceFileAST, filePath, fileHash };

    if (ts.isFunctionDeclaration(node)){
        // `export default function foo() {}` parses as a FunctionDeclaration
        // carrying a DefaultKeyword modifier, and its parent is the SourceFile —
        // NOT an ExportAssignment. Reading the parent's span is what used to make
        // every default-exported function swallow its entire file.
        const declaredName = node.name?.getText(sourceFileAST);
        const name = hasDefaultModifier(node) ? "default" : declaredName ?? "anonymous";

        return makeChunk({
            ...common,
            kind: isReactComponent(declaredName ?? name, filePath) ? "component" : "function",
            name,
            exported: isExported(node)
        });
    }

    if (ts.isClassDeclaration(node)){
        const declaredName = node.name?.getText(sourceFileAST);

        return makeChunk({
            ...common,
            kind: "class",
            name: hasDefaultModifier(node) ? "default" : declaredName ?? "anonymous",
            exported: isExported(node)
        });
    }

    if (ts.isVariableStatement(node)){
        // one statement can declare several names (`const a = 1, b = 2`). Naming
        // the chunk after only the first left the text containing a declaration
        // its own name never mentioned.
        const names = node.declarationList.declarations.map((d) => d.name.getText(sourceFileAST));

        return makeChunk({
            ...common,
            kind: names.some((n) => isReactComponent(n, filePath)) ? "component" : "const",
            name: names.join(", "),
            exported: isExported(node)
        });
    }

    if (ts.isInterfaceDeclaration(node)){
        return makeChunk({ ...common, kind: "interface", name: node.name.getText(sourceFileAST), exported: isExported(node) });
    }

    if (ts.isTypeAliasDeclaration(node)){
        return makeChunk({ ...common, kind: "type", name: node.name.getText(sourceFileAST), exported: isExported(node) });
    }

    if (ts.isEnumDeclaration(node)){
        return makeChunk({ ...common, kind: "enum", name: node.name.getText(sourceFileAST), exported: isExported(node) });
    }

    if (ts.isModuleDeclaration(node)){
        return makeChunk({ ...common, kind: "namespace", name: node.name.getText(sourceFileAST), exported: isExported(node) });
    }

    // `export default <expression>;` — a genuinely different node type from the
    // modifier form handled above (`export default function …`). Recording it
    // keeps "this module has a default export" retrievable.
    // `export = x` (isExportEquals) is the CommonJS form and is not a chunk.
    if (ts.isExportAssignment(node) && !node.isExportEquals){
        return makeChunk({ ...common, kind: "const", name: "default", exported: true });
    }

    // Re-exports (`export { x } from "./y"`) deliberately produce no chunk of
    // their own — they carry no implementation, and the file-summary chunk
    // already lists every one of them, which is the useful retrieval unit for a
    // barrel file. See ADR-020.
    return null;
}

// checks if a node is exported
function isExported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

// checks if a node carries the `default` modifier (`export default function …`)
function hasDefaultModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/**
 * Heuristic component detection: a JSX-capable file plus a PascalCase name.
 *
 * The all-caps guard matters — `name[0] === name[0].toUpperCase()` alone is true
 * for SCREAMING_SNAKE_CASE, which is how `STAR_COUNT` ended up classified as a
 * React component.
 */
function isReactComponent(name: string, filePath: string): boolean {
    if (!filePath.endsWith(".tsx") && !filePath.endsWith(".jsx")){
        return false;
    }

    // a JSX module's default export is its component by convention
    if (name === "default"){
        return true;
    }

    if (!/^[A-Z]/.test(name)){
        return false;
    }

    return !/^[A-Z0-9_]+$/.test(name); // reject CONSTANT_CASE
}

/**
 * Makes ids unique within a file.
 *
 * Overload signatures and declaration merging legitimately repeat a name at the
 * top level. `chunks.chunk_id` is UNIQUE, so a collision fails the insert for
 * the whole file. The display `name` is left alone — only the id segment gains
 * a `~n` marker — so nothing user-facing changes.
 */
export function disambiguateIds(chunks: CodeChunk[]): CodeChunk[] {
    const occurrences = new Map<string, number>();

    return chunks.map((chunk) => {
        const count = (occurrences.get(chunk.name) ?? 0) + 1;
        occurrences.set(chunk.name, count);

        const segment = count === 1 ? chunk.name : `${chunk.name}~${count}`;

        return { ...chunk, id: `${chunk.filePath}#${segment}#0` };
    });
}

// create a file-summary chunk that lists imports and exports
function createFileSummaryChunk(
    filePath: string,
    sourceFile: ts.SourceFile,
    fileHash: string
): CodeChunk {
    const imports: string[] = [];
    const exports: string[] = [];

    // walk through all statements to find imports and exports
    for (const statement of sourceFile.statements){
        // collect import statements
        if (ts.isImportDeclaration(statement)){
            imports.push(statement.getText(sourceFile).trim());
        }

        // collect re-exports (`export { x } from "./y"`) — these get no chunk of
        // their own, so this listing is the only place they are retrievable
        if (ts.isExportDeclaration(statement)){
            exports.push(statement.getText(sourceFile).trim());
        }

        // collect named exports from declarations
        if (isExported(statement)){
            const name = declarationName(statement, sourceFile);

            if (name){
                exports.push(`${name} (${declarationKind(statement)})`);
            }
        }

        // handle `export default <expression>;`
        if (ts.isExportAssignment(statement)){
            exports.push(statement.getText(sourceFile).trim());
        }
    }

    // build the summary text
    const summaryText = [
        `File: ${filePath}`,
        "",
        "Imports:",
        imports.length ? imports.join("\n") : "  (none)",
        "",
        "Exports:",
        exports.length ? exports.join("\n") : "  (none)"
    ].join("\n");

    // getEnd() sits *after* a trailing newline, which would land on the empty
    // line past the end of the file and report one line too many
    const lastLineIndex = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line;
    const endLine = sourceFile.text.endsWith("\n") ? Math.max(1, lastLineIndex) : lastLineIndex + 1;

    return {
        id: `${filePath}#(file)#0`,
        filePath,
        kind: "file-summary",
        name: "(file)",
        startLine: 1,
        endLine,
        exported: false,
        partIndex: 0,
        text: summaryText,
        fileHash
    };
}

// helper for createFileSummaryChunk: the declared name of a statement, if it has one
function declarationName(node: ts.Node, sourceFile: ts.SourceFile): string | null {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)){
        return node.name?.getText(sourceFile) ?? (hasDefaultModifier(node) ? "default" : "anonymous");
    }

    if (ts.isVariableStatement(node)){
        return node.declarationList.declarations
            .map((d) => d.name.getText(sourceFile))
            .join(", ") || null;
    }

    if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)
    ){
        return node.name.getText(sourceFile);
    }

    return null;
}

// helper for createFileSummaryChunk: get the kind of a declaration as a string
function declarationKind(node: ts.Node): string {
    if (ts.isFunctionDeclaration(node)) return "function";
    if (ts.isClassDeclaration(node)) return "class";
    if (ts.isVariableStatement(node)) return "const";
    if (ts.isInterfaceDeclaration(node)) return "interface";
    if (ts.isTypeAliasDeclaration(node)) return "type";
    if (ts.isEnumDeclaration(node)) return "enum";
    if (ts.isModuleDeclaration(node)) return "namespace";
    return "unknown";
}

/**
 * Splits declarations longer than MAX_CHUNK_LINES into overlapping parts.
 *
 * The window slides by `MAX_CHUNK_LINES - OVERLAP_LINES`, so every consecutive
 * pair of parts shares OVERLAP_LINES lines of context and the loop only stops
 * once the final line has been emitted. Computing a part count up front instead
 * (`ceil(lines / MAX)`) assumes non-overlapping windows and silently drops the
 * tail of anything long enough to need splitting.
 */
export function splitOversizedChunks(chunks: CodeChunk[]): CodeChunk[] {
    const result: CodeChunk[] = [];

    for (const chunk of chunks){
        const lines = chunk.text.split("\n");

        // The file-summary's text is synthetic (a generated listing) while its
        // line range deliberately spans the whole file, so the two are not
        // comparable and it must never be split on either measure.
        if (chunk.kind === "file-summary" || lines.length <= MAX_CHUNK_LINES){
            result.push(chunk);
            continue;
        }

        const stride = MAX_CHUNK_LINES - OVERLAP_LINES;
        // lastIndexOf, not split("#"), so a "#" inside the path can't corrupt the base
        const idBase = chunk.id.slice(0, chunk.id.lastIndexOf("#"));

        for (let start = 0, partIndex = 0; ; start += stride, partIndex++){
            const end = Math.min(start + MAX_CHUNK_LINES, lines.length);

            result.push({
                ...chunk,
                id: `${idBase}#${partIndex}`,
                partIndex,
                startLine: chunk.startLine + start,
                endLine: chunk.startLine + end - 1,
                text: lines.slice(start, end).join("\n")
            });

            if (end >= lines.length){
                break;
            }
        }
    }

    return result;
}
