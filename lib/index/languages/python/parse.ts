/**
 * Python's parse (the E4 plan's Task P): one tree-sitter tree gives a file's references (its specifiers), its
 * `__main__` marker (its declares), its symbols and its chunks. The scan reading, for files too big to parse, is a line
 * scan with no tree.
 *
 * Specifiers, in source order and each once:
 * - `import a.b.c` and `import a.b.c as d` → `a.b.c`;
 * - `from a.b import c` → `a.b:c`, `from a.b import *` → `a.b:*`, and relative `from ..m import c` → `..m:c`;
 * - `__import__("a.b")`, `importlib.import_module("a.b")`, and `import_module("a.b")` in a file holding
 *   `from importlib import import_module`, each with exactly one argument that is a plain string literal → `a.b`;
 * - nothing for `from __future__ import …`, a non-literal argument or an f-string. Imports anywhere count: inside a
 *   function, a `try`, or `if TYPE_CHECKING:`.
 */
import type { Node } from "web-tree-sitter";
import type { SymbolKind, SymbolRow } from "../../../db/schema";
import type { ParsedFile, Reading } from "../adapter";
import { assembleChunks, type Declaration } from "../chunking";
import { endLineOf, leadingSpan, parseTree, startLineOf, withoutBom } from "../treesitter";
import { countLines } from "../typescript";
import { emptyCallFacts } from "../typescript-calls";

const IDENTIFIER = /^[^\W\d]\w*$/u;
const DOTTED_NAME = /^[^\W\d]\w*(\.[^\W\d]\w*)*$/u;

/** The dotted name a dotted_name node spells, its identifiers joined by "." (`a . b` is legal Python), or null. */
function dottedText(node: Node | null): string | null {
    if (node === null || node.type !== "dotted_name") return null;
    const parts = node.namedChildren.filter((c) => c.type === "identifier").map((c) => c.text);
    return parts.length > 0 ? parts.join(".") : null;
}

/** The name an import binds from: a dotted_name, or an aliased_import's name (the alias doesn't matter here). */
function importedName(node: Node): string | null {
    return dottedText(node.type === "aliased_import" ? node.childForFieldName("name") : node);
}

/** A from-import's module: `a.b`, or a relative one written as its dots and then its name (`.`, `..m.n`). */
function fromModule(statement: Node): string | null {
    const source = statement.childForFieldName("module_name");
    if (source === null) return null;
    if (source.type === "dotted_name") return dottedText(source);
    if (source.type !== "relative_import") return null;
    let dots = "";
    let name = "";
    for (const child of source.namedChildren){
        if (child.type === "import_prefix") dots = child.text.replace(/\s+/g, "");
        else if (child.type === "dotted_name") name = dottedText(child) ?? "";
    }
    return /^\.+$/.test(dots) ? `${dots}${name}` : null;
}

/** A from-import's names, `*` for a wildcard. */
function fromNames(statement: Node): string[] {
    if (statement.namedChildren.some((c) => c.type === "wildcard_import")) return ["*"];
    return statement.childrenForFieldName("name").map(importedName).filter((n): n is string => n !== null && IDENTIFIER.test(n));
}

/** One import statement's specifiers (an import_statement or an import_from_statement). */
function statementSpecifiers(statement: Node): string[] {
    if (statement.type === "import_statement"){
        return statement.childrenForFieldName("name").map(importedName).filter((n): n is string => n !== null);
    }
    const source = fromModule(statement);
    if (source === null || source === "__future__") return [];
    return fromNames(statement).map((name) => `${source}:${name}`);
}

/**
 * A string literal's value when it is plain: no f-string or bytes prefix, no interpolation, no escape sequence, not
 * concatenated. Anything else is null: a module name built at run time is never guessed.
 */
function plainString(node: Node | null): string | null {
    if (node === null || node.type !== "string") return null;
    let start = "";
    let content = "";
    for (const child of node.children){
        if (child.type === "string_start") start = child.text;
        else if (child.type === "string_content"){
            if (child.namedChildCount > 0) return null;   // an escape sequence
            content += child.text;
        } else if (child.type === "interpolation") return null;
    }
    const prefix = start.replace(/["']+$/, "").toLowerCase();
    return prefix === "" || prefix === "r" || prefix === "u" ? content : null;
}

/** Whether the file binds the name `import_module` from importlib (`from importlib import import_module`). */
function bindsImportModule(statements: readonly Node[]): boolean {
    return statements.some((s) => s.type === "import_from_statement" && !s.hasError && fromModule(s) === "importlib"
        && s.childrenForFieldName("name").some((n) => n.type === "dotted_name" && n.text === "import_module"));
}

/** A dynamic import's module (`__import__("a.b")` and importlib's import_module), or null for any other call. */
function dynamicImport(call: Node, importModuleBound: boolean): string | null {
    const callee = call.childForFieldName("function");
    const args = call.childForFieldName("arguments");
    if (callee === null || args === null || args.type !== "argument_list") return null;
    let imports = false;
    if (callee.type === "identifier"){
        imports = callee.text === "__import__" || (callee.text === "import_module" && importModuleBound);
    } else if (callee.type === "attribute"){
        const object = callee.childForFieldName("object");
        imports = object?.type === "identifier" && object.text === "importlib" && callee.childForFieldName("attribute")?.text === "import_module";
    }
    if (!imports) return null;
    const given = args.namedChildren.filter((c) => c.type !== "comment");
    if (given.length !== 1) return null;
    const value = plainString(given[0]);
    return value !== null && DOTTED_NAME.test(value) ? value : null;
}

/** Every specifier of the tree, in source order, each once. */
function treeSpecifiers(root: Node): string[] {
    const nodes = root.descendantsOfType(["import_statement", "import_from_statement", "call"]);
    const importModuleBound = bindsImportModule(nodes);
    const found = new Set<string>();
    for (const node of nodes){
        if (node.type === "call"){
            const target = dynamicImport(node, importModuleBound);
            if (target !== null) found.add(target);
        } else if (!node.hasError){   // a statement the parser had to repair names nothing for sure
            for (const specifier of statementSpecifiers(node)) found.add(specifier);
        }
    }
    return [...found];
}

/** The named children that are statements (comments are extras the grammar puts anywhere). */
function statementsOf(node: Node | null): Node[] {
    return node === null ? [] : node.namedChildren.filter((c) => c.type !== "comment");
}

/** `__name__ == "__main__"`, either quote style, either operand order, any parentheses around it. */
function isMainGuard(statement: Node): boolean {
    if (statement.type !== "if_statement") return false;
    let condition = statement.childForFieldName("condition");
    while (condition?.type === "parenthesized_expression") condition = statementsOf(condition)[0] ?? null;
    if (condition?.type !== "comparison_operator") return false;
    const operands = statementsOf(condition);
    const operators = condition.children.filter((c) => !c.isNamed);
    if (operands.length !== 2 || operators.length !== 1 || operators[0].type !== "==") return false;
    const isName = (n: Node): boolean => n.type === "identifier" && n.text === "__name__";
    const isMain = (n: Node): boolean => plainString(n) === "__main__";
    return (isName(operands[0]) && isMain(operands[1])) || (isMain(operands[0]) && isName(operands[1]));
}

/** The names a target pattern binds: each name of a tuple or list target, a starred one's too; never `x.y` or `x[i]`. */
function patternNames(node: Node, out: string[]): void {
    switch (node.type){
        case "identifier":
            out.push(node.text);
            break;
        case "pattern_list":
        case "tuple_pattern":
        case "list_pattern":
        case "list_splat_pattern":
            for (const child of statementsOf(node)) patternNames(child, out);
            break;
        default:
            break;
    }
}

/** The names an assignment statement binds (`a = b = 1` binds both; an annotation alone binds its name), else []. */
function assignedNames(statement: Node): string[] {
    if (statement.type !== "expression_statement") return [];
    const names: string[] = [];
    for (const child of statementsOf(statement)){
        for (let assignment: Node | null = child; assignment?.type === "assignment"; assignment = assignment.childForFieldName("right")){
            const left = assignment.childForFieldName("left");
            if (left !== null) patternNames(left, names);
        }
    }
    return names;
}

/**
 * The names a top-level `__all__ = [...]` (or a tuple, or `__all__ += [...]`) lists, when every element is a plain string
 * literal; null when the module has no such statement (then a name is exported unless it starts with "_").
 */
function exportList(statements: readonly Node[]): Set<string> | null {
    let listed: Set<string> | null = null;
    for (const statement of statements){
        if (statement.type !== "expression_statement") continue;
        const inner = statementsOf(statement)[0];
        if (inner === undefined || (inner.type !== "assignment" && inner.type !== "augmented_assignment")) continue;
        const left = inner.childForFieldName("left");
        const right = inner.childForFieldName("right");
        if (left?.type !== "identifier" || left.text !== "__all__" || right === null) continue;
        if (inner.type === "augmented_assignment" && inner.childForFieldName("operator")?.type !== "+=") continue;
        if (right.type !== "list" && right.type !== "tuple") continue;
        const values = statementsOf(right).map(plainString);
        if (values.some((v) => v === null)) continue;
        listed ??= new Set();
        for (const v of values) listed.add(v!);
    }
    return listed;
}

/** The definition inside a decorated_definition, or the node itself. */
function definitionOf(node: Node): Node | null {
    return node.type === "decorated_definition" ? node.childForFieldName("definition") : node;
}

/** `@property`, `@<x>.setter` or `@<x>.deleter` among a decorated definition's decorators. */
function isAccessor(node: Node): boolean {
    if (node.type !== "decorated_definition") return false;
    return node.namedChildren.filter((c) => c.type === "decorator").some((decorator) => {
        const expression = statementsOf(decorator)[0];
        if (expression?.type === "identifier") return expression.text === "property";
        if (expression?.type === "attribute"){
            const attribute = expression.childForFieldName("attribute")?.text;
            return attribute === "setter" || attribute === "deleter";
        }
        return false;
    });
}

const isDunder = (name: string): boolean => name.length > 4 && name.startsWith("__") && name.endsWith("__");

/** A class's members, one level: methods, its constructor, accessors, class-level assignments and annotations, nested classes. */
function classMembers(definition: Node, parent: string, classExported: boolean): SymbolRow[] {
    const members: SymbolRow[] = [];
    const add = (name: string, kind: SymbolKind, node: Node): void => {
        members.push({
            name, qualifiedName: `${parent}.${name}`, kind, startLine: startLineOf(node), endLine: endLineOf(node),
            exported: classExported && (!name.startsWith("_") || isDunder(name)), parentQualifiedName: parent,
        });
    };
    for (const statement of statementsOf(definition.childForFieldName("body"))){
        const inner = definitionOf(statement);
        if (inner?.type === "function_definition"){
            const name = inner.childForFieldName("name")?.text;
            if (name !== undefined) add(name, name === "__init__" ? "constructor" : isAccessor(statement) ? "accessor" : "method", statement);
        } else if (inner?.type === "class_definition"){
            const name = inner.childForFieldName("name")?.text;
            if (name !== undefined) add(name, "class", statement);
        } else{
            for (const name of assignedNames(statement)) add(name, "property", statement);
        }
    }
    return members;
}

/** The name `type X = …` (or `type X[T] = …`) declares. */
function typeAliasName(statement: Node): string | null {
    const left = statement.childForFieldName("left");
    const inner = left === null ? undefined : statementsOf(left)[0];
    if (inner?.type === "identifier") return inner.text;
    if (inner?.type === "generic_type") return inner.namedChildren.find((c) => c.type === "identifier")?.text ?? null;
    return null;
}

/** A comment on lines of its own (not one trailing the statement before it) attaches to the declaration below it. */
function isLeadingComment(previous: Node): boolean {
    if (previous.type !== "comment") return false;
    const before = previous.previousSibling;
    return before === null || endLineOf(before) < startLineOf(previous);
}

/** Statements at module level: the module's own, and those inside its top-level if, try and with blocks. */
function moduleLevelStatements(root: Node): Node[] {
    const out: Node[] = [];
    const visit = (statements: readonly Node[]): void => {
        for (const statement of statements){
            out.push(statement);
            if (statement.type === "if_statement" || statement.type === "try_statement" || statement.type === "with_statement"
                || statement.type === "elif_clause" || statement.type === "else_clause" || statement.type === "except_clause"
                || statement.type === "finally_clause"){
                for (const child of statementsOf(statement)){
                    if (child.type === "block") visit(statementsOf(child));
                    else if (child.type.endsWith("_clause")) visit([child]);
                }
            }
        }
    };
    visit(statementsOf(root));
    return out;
}

type Products = { imports: string[]; declares: string[]; symbols: SymbolRow[]; declarations: Declaration[]; summaryImports: string[]; exports: string[] };

/** Everything one tree gives (symbols and chunk declarations only when `full`). */
function readTree(root: Node, full: boolean): Products {
    const imports = treeSpecifiers(root);
    const statements = statementsOf(root);
    const declares = statements.some(isMainGuard) ? ["__main__"] : [];
    const products: Products = { imports, declares, symbols: [], declarations: [], summaryImports: [], exports: [] };
    if (!full) return products;

    const listed = exportList(statements);
    const isExported = (name: string): boolean => (listed === null ? !name.startsWith("_") : listed.has(name));
    const span = (node: Node): { startLine: number; endLine: number } => leadingSpan(node, isLeadingComment);
    const top = (name: string, kind: SymbolKind, node: Node): SymbolRow => ({
        name, qualifiedName: name, kind, startLine: startLineOf(node), endLine: endLineOf(node), exported: isExported(name), parentQualifiedName: null,
    });

    for (const statement of statements){
        const inner = definitionOf(statement);
        if (inner?.type === "function_definition" || inner?.type === "class_definition"){
            const name = inner.childForFieldName("name")?.text;
            if (name === undefined) continue;
            const kind = inner.type === "class_definition" ? "class" : "function";
            products.symbols.push(top(name, kind, statement));
            if (kind === "class") products.symbols.push(...classMembers(inner, name, isExported(name)));
            products.declarations.push({ kind, name, ...span(statement), exported: isExported(name) });
            if (isExported(name)) products.exports.push(`${name} (${kind})`);
        } else if (statement.type === "type_alias_statement"){
            const name = typeAliasName(statement);
            if (name === null) continue;
            products.symbols.push(top(name, "type", statement));
            products.declarations.push({ kind: "type", name, ...span(statement), exported: isExported(name) });
            if (isExported(name)) products.exports.push(`${name} (type)`);
        } else{
            const names = assignedNames(statement);
            if (names.length === 0) continue;
            for (const name of names){
                products.symbols.push(top(name, "const", statement));
                if (isExported(name)) products.exports.push(`${name} (const)`);
            }
            // one chunk per statement, named by every name it binds (lib/chunks.ts's rule for `const a = 1, b = 2`)
            products.declarations.push({ kind: "const", name: names.join(", "), ...span(statement), exported: names.some(isExported) });
        }
    }

    for (const statement of moduleLevelStatements(root)){
        if ((statement.type === "import_statement" || statement.type === "import_from_statement") && !statement.hasError){
            products.summaryImports.push(statement.text.replace(/\r/g, "").trim());
        }
    }
    return products;
}

/** A line without its comment. */
const withoutComment = (line: string): string => (line.includes("#") ? line.slice(0, line.indexOf("#")) : line);

/** One import statement's specifiers, read from its text (the scan reading). Malformed text gives none. */
function textSpecifiers(statement: string): string[] {
    const plain = /^import\s+(.+)$/u.exec(statement);
    if (plain !== null){
        return plain[1].split(",").map((part) => /^\s*(\S+)(\s+as\s+\S+)?\s*$/u.exec(part)?.[1] ?? "").filter((n) => DOTTED_NAME.test(n));
    }
    const from = /^from\s*(\.+)\s*import\s+(.+)$/u.exec(statement)
        ?? /^from(?:\s+|(?=\.))(\.*[^\W\d]\w*(?:\.[^\W\d]\w*)*)\s+import\s+(.+)$/u.exec(statement);
    if (from === null || from[1] === "__future__") return [];
    const names = from[2].replace(/[()]/g, " ").split(",").map((part) => part.trim()).filter((part) => part !== "");
    if (names.length === 1 && names[0] === "*") return [`${from[1]}:*`];
    return names.map((part) => /^(\S+)(\s+as\s+\S+)?$/u.exec(part)?.[1] ?? "").filter((n) => IDENTIFIER.test(n)).map((n) => `${from[1]}:${n}`);
}

/**
 * The scan reading: the import statements that start a line at column 0, `import …` or `from … import …`, a
 * parenthesized name list read on to its ")". It reads no tree, so it doesn't see indented imports (in a function,
 * a try, `if TYPE_CHECKING:`) or dynamic ones, and it would read an import written at column 0 inside a string.
 */
export function scanPythonImports(text: string): string[] {
    const lines = withoutBom(text).split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
    const found = new Set<string>();
    for (let i = 0; i < lines.length; i++){
        if (!/^(import|from)[\s.]/.test(lines[i])) continue;
        let statement = withoutComment(lines[i]);
        if (statement.startsWith("from") && statement.includes("(")){
            while (!statement.includes(")") && i + 1 < lines.length) statement += ` ${withoutComment(lines[++i])}`;
        }
        for (const piece of statement.split(";")) for (const specifier of textSpecifiers(piece.trim())) found.add(specifier);
    }
    return [...found];
}

/** One Python file's products in the given reading (adapter.ts's ParsedFile). */
export function parsePythonFile(path: string, text: string, reading: Reading): ParsedFile {
    const lineCount = countLines(withoutBom(text));
    if (reading === "scan"){
        return { chunks: [], symbols: [], imports: scanPythonImports(text), declares: [], calls: emptyCallFacts(), lineCount };
    }
    const full = reading === "full";
    const products = parseTree("python", text, (root) => readTree(root, full));
    return {
        chunks: full ? assembleChunks(path, text, products.declarations, { imports: products.summaryImports, exports: products.exports }) : [],
        symbols: products.symbols,
        imports: products.imports,
        declares: products.declares,
        calls: emptyCallFacts(),
        lineCount,
    };
}
