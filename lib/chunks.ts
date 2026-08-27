// FOR CLAUDE: didnt use ChunkKind type from contracts.ts so idk if we need to fix that and incorporate all of the chunk kinds
// from there

import ts from "typescript";
import crypto from "crypto";
import type { CodeChunk } from "./contracts";

// parse the file into a TypeScript AST
function parseFile(filePath: string, fileText: string): ts.SourceFile {
    return ts.createSourceFile(
        filePath,
        fileText,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
    );
}

export function extractChunksFromFile(filePath: string, fileText: string): CodeChunk[] {
    const sourceFileAST = parseFile(filePath, fileText);
    const fileHash = crypto.createHash("sha256").update(fileText).digest("hex");
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

    return splitOversizedChunks(chunks);
}

function processStatement(
    node: ts.Statement,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    // check for FunctionDeclaration that might be a default export
    if (ts.isFunctionDeclaration(node)) {
        const parent = node.parent;
        
        // check if the function has a default export modifier
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        const hasDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) || false;

        // also check if the parent is an ExportAssignment
        const parentIsExport = parent && ts.isExportAssignment(parent);

        if (hasDefault || parentIsExport) {
            return processDefaultExportFunction(node, sourceFileAST, filePath, fileHash);
        }

        return processFunctionDeclaration(node, sourceFileAST, filePath, fileHash);
    }

    if (ts.isClassDeclaration(node)){
        const parent = node.parent;

        if (parent && ts.isExportAssignment(parent)){
            return processDefaultExportClass(node, sourceFileAST, filePath, fileHash);
        }

        return processClassDeclaration(node, sourceFileAST, filePath, fileHash);
    }

    if (ts.isVariableStatement(node)){
        return processVariableStatement(node, sourceFileAST, filePath, fileHash);
    }

    if (ts.isInterfaceDeclaration(node)){
        return processInterfaceDeclaration(node, sourceFileAST, filePath, fileHash);
    }

    if (ts.isTypeAliasDeclaration(node)){
        return processTypeAliasDeclaration(node, sourceFileAST, filePath, fileHash);
    }

    return null;
}

/*
helper functions for processStatement to handle specific node types (function, class, variable, interface, type alias, export assignment)
*/

// process a function declaration that is a default export and return a CodeChunk
function processDefaultExportFunction(
    node: ts.FunctionDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    // Get the parent ExportAssignment node
    const parent = node.parent as ts.ExportAssignment;
    const start = sourceFileAST.getLineAndCharacterOfPosition(parent.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(parent.getEnd());

    return {
        id: `${filePath}#default#0`,
        filePath,
        kind: "function",
        name: "default",
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: true,
        partIndex: 0,
        text: parent.getFullText(sourceFileAST),
        fileHash
    };
}

// process a function declaration node and return a CodeChunk
function processFunctionDeclaration(
    node: ts.FunctionDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string, 
    fileHash: string
): CodeChunk | null {
    const name = node.name?.getText(sourceFileAST) || "anonymous";

    const start = sourceFileAST.getLineAndCharacterOfPosition(node.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(node.getEnd());

    const isComponent = isReactComponent(node, sourceFileAST, filePath);

    return {
        id: `${filePath}#${name}#0`,
        filePath,
        kind: isComponent ? "component" : "function",
        name,
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: isExported(node),
        partIndex: 0,
        text: node.getFullText(sourceFileAST),
        fileHash
    };
}

// process a class declaration that is a default export and return a CodeChunk
function processDefaultExportClass(
    node: ts.ClassDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    const parent = node.parent as ts.ExportAssignment;
    const start = sourceFileAST.getLineAndCharacterOfPosition(parent.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(parent.getEnd());

    return {
        id: `${filePath}#default#0`,
        filePath,
        kind: "class",
        name: "default",
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: true,
        partIndex: 0,
        text: parent.getFullText(sourceFileAST),
        fileHash
    };
}

// process a class declaration node and return a CodeChunk
function processClassDeclaration(
    node: ts.ClassDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    const name = node.name?.getText(sourceFileAST) || "anonymous";

    const start = sourceFileAST.getLineAndCharacterOfPosition(node.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(node.getEnd());

    return {
        id: `${filePath}#${name}#0`,
        filePath,
        kind: "class",
        name,
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: isExported(node),
        partIndex: 0,
        text: node.getFullText(sourceFileAST),
        fileHash
    };
}

// process a variable statement node and return a CodeChunk
function processVariableStatement(
    node: ts.VariableStatement,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    // Get the first variable declaration (most common case)
    const declaration = node.declarationList.declarations[0];
    const name = declaration.name.getText(sourceFileAST);

    const start = sourceFileAST.getLineAndCharacterOfPosition(node.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(node.getEnd());

    // Check if it's a React component (starts with uppercase)
    const isComponent = filePath.endsWith(".tsx") && 
                        name[0] === name[0].toUpperCase();

    return {
        id: `${filePath}#${name}#0`,
        filePath,
        kind: isComponent ? "component" : "const",
        name,
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: isExported(node),
        partIndex: 0,
        text: node.getFullText(sourceFileAST),
        fileHash
    };
}

// process an interface declaration node and return a CodeChunk
function processInterfaceDeclaration(
    node: ts.InterfaceDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    const name = node.name.getText(sourceFileAST);

    const start = sourceFileAST.getLineAndCharacterOfPosition(node.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(node.getEnd());

    return {
        id: `${filePath}#${name}#0`,
        filePath,
        kind: "interface",
        name,
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: isExported(node),
        partIndex: 0,
        text: node.getFullText(sourceFileAST),
        fileHash
    };
}

// process a type alias declaration node and return a CodeChunk
function processTypeAliasDeclaration(
    node: ts.TypeAliasDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string,
    fileHash: string
): CodeChunk | null {
    const name = node.name.getText(sourceFileAST);

    const start = sourceFileAST.getLineAndCharacterOfPosition(node.getStart(sourceFileAST));
    const end = sourceFileAST.getLineAndCharacterOfPosition(node.getEnd());

    return {
        id: `${filePath}#${name}#0`,
        filePath,
        kind: "type",
        name,
        startLine: start.line + 1,
        endLine: end.line + 1,
        exported: isExported(node),
        partIndex: 0,
        text: node.getFullText(sourceFileAST),
        fileHash
    };
}

// checks if a node is exported
function isExported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

// checks if a function declaration is a React component based on its name and file extension
function isReactComponent(
    node: ts.FunctionDeclaration,
    sourceFileAST: ts.SourceFile,
    filePath: string
): boolean {
    // Must be in a TSX/JSX file
    if (!filePath.endsWith(".tsx") && !filePath.endsWith(".jsx")) {
        return false;
    }

    const name = node.name?.getText(sourceFileAST);
    if (!name) return false;

    // Must start with uppercase
    if (name[0] !== name[0].toUpperCase()) {
        return false;
    }

    return true;
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
            const importText = statement.getFullText(sourceFile).trim();
            imports.push(importText);
        }

        // collect export declarations
        if (ts.isExportDeclaration(statement)){
            const exportText = statement.getFullText(sourceFile).trim();
            exports.push(exportText);
        }

        // collect named exports from function/class/variable declarations
        if (ts.isFunctionDeclaration(statement) || 
            ts.isClassDeclaration(statement) ||
            ts.isVariableStatement(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement)){
        
            if (isExported(statement)){
                let name = "";
                if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)){
                    name = statement.name?.getText(sourceFile) || "anonymous";
                } else if (ts.isVariableStatement(statement)){
                    name = statement.declarationList.declarations[0]?.name.getText(sourceFile) || "anonymous";
                } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)){
                    name = statement.name.getText(sourceFile);
                }

                if (name){
                    const kind = getKind(statement);
                    exports.push(`${name} (${kind})`);
                }
            }
        }

        // handle export default
        if (ts.isExportAssignment(statement)){
            const exportText = statement.getFullText(sourceFile).trim();
            exports.push(exportText);
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

    return {
        id: `${filePath}#(file)#0`,
        filePath,
        kind: "file-summary",
        name: "(file)",
        startLine: 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1,
        exported: false,
        partIndex: 0,
        text: summaryText,
        fileHash
    };
}

// helper for createFileSummaryChunk: get the kind of a declaration as a string
function getKind(node: ts.Node): string {
    if (ts.isFunctionDeclaration(node)) return "function";
    if (ts.isClassDeclaration(node)) return "class";
    if (ts.isVariableStatement(node)) return "const";
    if (ts.isInterfaceDeclaration(node)) return "interface";
    if (ts.isTypeAliasDeclaration(node)) return "type";
    return "unknown";
}

// split oversized chunks into smaller ones with a 3-line overlap
const MAX_CHUNK_LINES = 200;
const OVERLAP = 3;

function splitOversizedChunks(chunks: CodeChunk[]): CodeChunk[] {
    const result: CodeChunk[] = [];

    for (const chunk of chunks){
        const lineCount = chunk.endLine - chunk.startLine + 1;
        if (lineCount <= MAX_CHUNK_LINES) {
            result.push(chunk);
            continue;
        }

        // split into parts
        const lines = chunk.text.split("\n");
        const parts = Math.ceil(lines.length / MAX_CHUNK_LINES);

        for (let i = 0; i < parts; i++){
            const start = Math.max(0, i * MAX_CHUNK_LINES - OVERLAP + 1); // 3-line overlap
            const end = Math.min(start + MAX_CHUNK_LINES, lines.length);
            const partLines = lines.slice(start, end);
            const partText = partLines.join("\n");

            result.push({
                ...chunk,
                id: `${chunk.id.split("#").slice(0, 2).join("#")}#${i + 1}`,
                partIndex: i + 1,
                startLine: chunk.startLine + start,
                endLine: chunk.startLine + end - 1,
                text: partText
            });
        }
    }

    return result;
}