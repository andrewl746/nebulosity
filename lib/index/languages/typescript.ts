import ts from "typescript";
import { extractChunksFromSourceFile, parseSourceFile } from "../../chunks";
import type { CodeChunk } from "../../contracts";
import type { SymbolKind, SymbolRow } from "../../db/schema";

/** Every extension this adapter claims (TypeScript parses JavaScript too). */
export const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * What this adapter reads from a file, versioned. Bump it whenever a change gives an unchanged file different imports,
 * symbols or chunks: a full run then parses every file again once, where it would otherwise keep what the older
 * adapter stored for every file whose bytes haven't changed (ADR-053). 1: V1.1–V1.5. 2: computed import() (ADR-053).
 * 3: import type expressions, `typeof import("x")` (ADR-053, amended). 4: files of 1–5 MB parsed in full for their
 * imports, not token-scanned (ADR-053, amended).
 */
export const ADAPTER_VERSION = 4;

/** files.language for a path this adapter claims. TypeScript's parser reads both languages. */
export function languageOf(filePath: string): "typescript" | "javascript" {
    return /\.(js|jsx|mjs|cjs)$/.test(filePath) ? "javascript" : "typescript";
}

export type ParsedFile = {
    chunks: CodeChunk[];
    symbols: SymbolRow[];
    /** Raw specifiers in source order, each once: "./a", "@core/log", "react". */
    imports: string[];
    lineCount: number;
};

/** One parse, three products. This is the adapter seam tree-sitter adapters plug into later (E4). */
export function parseTypeScriptFile(filePath: string, text: string): ParsedFile {
    const sourceFile = parseSourceFile(filePath, text);

    return {
        chunks: extractChunksFromSourceFile(filePath, sourceFile),
        symbols: collectSymbols(sourceFile),
        imports: collectImports(sourceFile),
        lineCount: countLines(text),
    };
}

/**
 * A file over the 1 MB cap, up to 5 MB (ADR-053, amended): parsed in full, but only its imports are kept, so they
 * follow exactly the rule every other file's do. Its declarations and chunks are dropped: no code search, no summary.
 * The full parse of VS Code's 1.0–1.6 MB agent-host tests takes 90–150 ms.
 */
export function parseTypeScriptImportsOnly(filePath: string, text: string): ParsedFile {
    return { chunks: [], symbols: [], imports: collectImports(parseSourceFile(filePath, text)), lineCount: countLines(text) };
}

/** What comes just before a module augmentation's name. No import statement ends this way. */
const AUGMENTATION = /\bdeclare\s+module\s*$/;

/**
 * A file over 5 MB, up to the 20 MB bound (ADR-053, amended): only its imports, read by TypeScript's preProcessFile, a
 * token scan with no syntax tree and so no idea where a regex literal or JSX text starts. On a 3.8 MB minified bundle
 * it takes 65 ms and 23 MB of heap where a full parse takes 830 ms and 180 MB, so a giant generated file can't stall a
 * run. It reads the statements collectImports reads, except that:
 * - a regex literal holding a backtick hides every import up to the next backtick, and one holding a quote hides the
 *   rest of its line (` and ' or " start a template or a string to the scan);
 * - the words inside a regex literal or JSX text can make up an import (`/import x from "y"/` gives "y");
 * - it counts a member call `foo.require("x")` and a two-argument `require("x", y)`, and an AMD `define([...])` list;
 * - it misses `export * as ns from "x"`, `export type * as ns from "x"` and a computed import();
 * - it reports a module augmentation (`declare module "x"` in a module) as an import, which is dropped here.
 */
export function scanTypeScriptImports(filePath: string, text: string): ParsedFile {
    const preProcessed = ts.preProcessFile(text, true, true);   // readImportFiles, detectJavaScriptImports (require)
    const imports = preProcessed.importedFiles
        .filter((ref) => !AUGMENTATION.test(text.slice(Math.max(0, ref.pos - 64), ref.pos)))   // ref.pos is the quote's
        .map((ref) => ref.fileName);

    return { chunks: [], symbols: [], imports: [...new Set(imports)], lineCount: countLines(text) };
}

/** Lines as an editor numbers them: a trailing newline does not start an extra line. */
export function countLines(text: string): number {
    if (text === "") return 0;
    const parts = text.split("\n").length;
    return text.endsWith("\n") ? parts - 1 : parts;
}

/**
 * Every module this file depends on, read from the AST, so an import-looking string
 * like "import x from './y'" is (correctly) just a string. That was the regex
 * extractor's known false-positive class (ADR-016), which this retires (ADR-026).
 */
function collectImports(sourceFile: ts.SourceFile): string[] {
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)){
            found.push(node.moduleSpecifier.text);                      // import … from "x" · export … from "x" · import "x"
        } else if (ts.isImportEqualsDeclaration(node)
            && ts.isExternalModuleReference(node.moduleReference)
            && ts.isStringLiteral(node.moduleReference.expression)){
            found.push(node.moduleReference.expression.text);           // import x = require("x")
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)){
            // typeof import("x") · import("x").T: a type-only reference, which the import rule counts (ADR-053, amended).
            // forEachChild never enters JSDoc, so a `{import("x").T}` in a comment stays a comment.
            found.push(node.argument.literal.text);
        } else if (ts.isCallExpression(node) && node.arguments.length === 1){
            // bind first: TypeScript does not reliably narrow a re-read of node.arguments[0]
            const arg = node.arguments[0];
            const callee = node.expression;
            const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(callee) && callee.text === "require";

            if ((isDynamicImport || isRequire) && ts.isStringLiteralLike(arg)){
                found.push(arg.text);                                    // import("x") · require("x")
            } else if (isDynamicImport && ts.isIdentifier(arg)){
                found.push(...literalsAssignedTo(arg));                  // import(url): the literals url is given (ADR-053)
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return [...new Set(found)];
}

/**
 * The strings a variable is sure to hold when `import(variable)` reads it, in source order: its initializer and every
 * plain assignment to it inside the same function (or file). A literal, a template without ${…}, and
 * `new URL("<literal>", …)` (with .href or .toString()) count. A parameter, a template with ${…} or a call gives
 * nothing: the code doesn't name the file (Review Focus 2).
 */
function literalsAssignedTo(name: ts.Identifier): string[] {
    let scope: ts.Node = name;
    while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name.text && node.initializer){
            const text = literalOf(node.initializer);
            if (text !== null) found.push(text);
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(node.left) && node.left.text === name.text){
            const text = literalOf(node.right);
            if (text !== null) found.push(text);
        }
        ts.forEachChild(node, visit);
    };
    visit(scope);
    return found;
}

/** A string an expression is sure to hold, or null. */
function literalOf(expression: ts.Expression): string | null {
    if (ts.isParenthesizedExpression(expression)) return literalOf(expression.expression);
    if (ts.isStringLiteralLike(expression)) return expression.text;
    if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "URL"){
        const first = expression.arguments?.[0];
        return first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
    }
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === "href") return literalOf(expression.expression);
    if (ts.isCallExpression(expression) && expression.arguments.length === 0 && ts.isPropertyAccessExpression(expression.expression)
        && expression.expression.name.text === "toString"){
        return literalOf(expression.expression.expression);
    }
    return null;
}

function collectSymbols(sourceFile: ts.SourceFile): SymbolRow[] {
    const symbols: SymbolRow[] = [];
    const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

    const add = (node: ts.Node, name: string, kind: SymbolKind, exported: boolean, parent: string | null): void => {
        symbols.push({
            name,
            qualifiedName: parent ? `${parent}.${name}` : name,
            kind,
            // getStart skips leading trivia, so the doc comment is excluded: the range
            // is for jumping to the declaration (chunks keep the comment, ADR-018)
            startLine: lineOf(node.getStart(sourceFile)),
            endLine: lineOf(node.getEnd()),
            exported,
            parentQualifiedName: parent,
        });
    };

    for (const statement of sourceFile.statements){
        const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);

        if (ts.isFunctionDeclaration(statement) && statement.name){
            add(statement, statement.name.text, "function", exported, null);
        } else if (ts.isClassDeclaration(statement) && statement.name){
            const className = statement.name.text;
            add(statement, className, "class", exported, null);

            for (const member of statement.members){
                const memberName = simpleName(member.name);
                const isPrivate = hasModifier(member, ts.SyntaxKind.PrivateKeyword) || (!!member.name && ts.isPrivateIdentifier(member.name));
                const memberExported = exported && !isPrivate;

                if (ts.isConstructorDeclaration(member)) add(member, "constructor", "constructor", memberExported, className);
                else if (memberName === null) continue;   // computed names like [Symbol.iterator]
                else if (ts.isMethodDeclaration(member)) add(member, memberName, "method", memberExported, className);
                else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) add(member, memberName, "accessor", memberExported, className);
                else if (ts.isPropertyDeclaration(member)) add(member, memberName, "property", memberExported, className);
            }
        } else if (ts.isInterfaceDeclaration(statement)){
            add(statement, statement.name.text, "interface", exported, null);
        } else if (ts.isTypeAliasDeclaration(statement)){
            add(statement, statement.name.text, "type", exported, null);
        } else if (ts.isEnumDeclaration(statement)){
            add(statement, statement.name.text, "enum", exported, null);
        } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)){
            add(statement, statement.name.text, "namespace", exported, null);
        } else if (ts.isVariableStatement(statement)){
            for (const declaration of statement.declarationList.declarations){
                if (!ts.isIdentifier(declaration.name)) continue;   // destructuring patterns have no single name

                const init = declaration.initializer;
                const isFunction = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
                add(declaration, declaration.name.text, isFunction ? "function" : "const", exported, null);
            }
        }
    }

    return symbols;
}

function simpleName(name: ts.PropertyName | undefined): string | null {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((m) => m.kind === kind);
}
