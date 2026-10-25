/**
 * One Go file's products (Task G of the E4 plan, ADR-065), read from a tree-sitter-go tree in one walk.
 *
 * Go has no per-name imports: a file imports a package (a folder) and then names its members as `pkg.Name`, and it
 * reaches the other files of its own package by bare names, with no import at all. So the specifiers are of three
 * classes, which resolve.ts turns into edges:
 * - `import:<path>[ as <alias>]`: each import spec;
 * - `use:<x>.<Name>`: a selector or qualified type whose operand is a free identifier (usually an import's alias);
 * - `name:<N>`: a free identifier, which may be declared by another file of the package.
 * "Free" means neither bound in the enclosing function nor declared at the file's top level, nor predeclared. The
 * binding check is per function, not per block (the plan's approximation): a name bound anywhere in the outermost
 * function counts as bound everywhere in it. Missing a binding would invent a reference; over-binding loses one only
 * when a function shadows a package-level name and also uses that name, which is rare.
 */
import type { Node } from "web-tree-sitter";
import type { CodeChunk } from "../../../contracts";
import type { SymbolKind, SymbolRow } from "../../../db/schema";
import type { ParsedFile, Reading } from "../adapter";
import { assembleChunks, type Declaration } from "../chunking";
import { endLineOf, leadingSpan, parseTree, startLineOf, withoutBom } from "../treesitter";
import { countLines } from "../typescript";
import { emptyCallFacts } from "../typescript-calls";

/** Go's predeclared identifiers (the plan's list): never a reference to a repo file. */
export const PREDECLARED: ReadonlySet<string> = new Set([
    "any", "bool", "byte", "comparable", "complex64", "complex128", "error", "float32", "float64", "int", "int8", "int16",
    "int32", "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "true", "false", "iota",
    "nil", "append", "cap", "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max", "min", "new",
    "panic", "print", "println", "real", "recover",
]);

const TOP_LEVEL_DECLARATIONS = new Set(["function_declaration", "method_declaration", "type_declaration", "const_declaration", "var_declaration"]);

/** An import spec, as the full reading and the scan both write it. */
export function importSpecifier(path: string, alias: string | null): string {
    return alias === null ? `import:${path}` : `import:${path} as ${alias}`;
}

/** The text between a string literal's quotes ("…" or `…`), or null for an empty or unterminated one. */
function stringContent(literal: Node | null): string | null {
    if (literal === null || literal.hasError || literal.isMissing) return null;
    const text = literal.text;
    if (text.length < 2) return null;
    const content = text.slice(1, -1);
    return content === "" ? null : content;
}

/** A node's named children of one type. */
const childrenOfType = (node: Node, type: string): Node[] => node.namedChildren.filter((c) => c !== null && c.type === type) as Node[];

/** The identifiers a field holds, `_` included (callers decide), MISSING ones left out. */
function identifiersOf(node: Node, field: string): string[] {
    return node.childrenForFieldName(field).filter((c): c is Node => c !== null && c.type === "identifier" && !c.isMissing).map((c) => c.text);
}

/** The identifiers directly in an expression list (`a, b :=`), each a plain name. */
function listIdentifiers(list: Node | null): string[] {
    if (list === null) return [];
    if (list.type === "identifier") return [list.text];
    return childrenOfType(list, "identifier").map((c) => c.text);
}

/** Whether a node has an anonymous `:=` token among its children (a range clause or receive that declares). */
function declaresWithColon(node: Node): boolean {
    return node.children.some((c) => c !== null && !c.isNamed && c.type === ":=");
}

/**
 * Every name a function binds anywhere inside it (the plan's function-level approximation): parameters, results and
 * the receiver (of nested function literals too), type parameters, `:=`, var and const, range and select receives
 * that declare, a type switch's alias, labels, local types (G-7), and a method receiver's type parameters (G-8).
 * An explicit stack, not recursion: a long chain of `+` or `else if` nests deeper than the call stack goes (B-I1).
 */
function bindingsOf(fn: Node): Set<string> {
    const bound = new Set<string>();
    const stack: Node[] = [fn];
    while (stack.length > 0){
        const node = stack.pop()!;
        switch (node.type){
            case "parameter_declaration":
            case "variadic_parameter_declaration":
            case "type_parameter_declaration":
            case "const_spec":
            case "var_spec":
                for (const name of identifiersOf(node, "name")) bound.add(name);
                break;
            case "short_var_declaration":
                for (const name of listIdentifiers(node.childForFieldName("left"))) bound.add(name);
                break;
            case "range_clause":
            case "receive_statement":
                if (declaresWithColon(node)) for (const name of listIdentifiers(node.childForFieldName("left"))) bound.add(name);
                break;
            case "type_switch_statement":
                for (const name of listIdentifiers(node.childForFieldName("alias"))) bound.add(name);
                break;
            case "labeled_statement": {
                const label = node.childForFieldName("label");
                if (label !== null) bound.add(label.text);
                break;
            }
            case "type_spec":
            case "type_alias": {
                const name = node.childForFieldName("name");
                if (name !== null) bound.add(name.text);
                break;
            }
        }
        // the order doesn't matter (a set of names), but the walk stays the recursion's pre-order
        const children = node.namedChildren;
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }

    // G-8: `func (b Box[T]) …` declares T for the method
    if (fn.type === "method_declaration"){
        const receiverType = receiverTypeNode(fn);
        const args = receiverType?.type === "generic_type" ? receiverType.childForFieldName("type_arguments") : null;
        if (args !== null) for (const id of args.descendantsOfType("type_identifier")) if (id !== null) bound.add(id.text);
    }
    return bound;
}

/** A method's receiver type, without `*` or parentheses (a type_identifier, or a generic_type for `Box[T]`). */
function receiverTypeNode(method: Node): Node | null {
    const receiver = method.childForFieldName("receiver");
    const param = receiver?.namedChildren.find((c) => c !== null && (c.type === "parameter_declaration" || c.type === "variadic_parameter_declaration")) ?? null;
    let type = param?.childForFieldName("type") ?? null;
    while (type !== null && (type.type === "pointer_type" || type.type === "parenthesized_type")) type = type.namedChildren[0] ?? null;
    return type;
}

/** A method's receiver type name: `*Store` and `Box[T]` give Store and Box. */
function receiverName(method: Node): string | null {
    const type = receiverTypeNode(method);
    if (type === null) return null;
    if (type.type === "type_identifier") return type.text;
    if (type.type === "generic_type") return type.childForFieldName("type")?.text ?? null;
    return null;
}

/** The name an embedded struct field goes by: its type's own name (`sync.Mutex` → Mutex, `*Base[T]` → Base). */
function embeddedName(type: Node | null): string | null {
    let t = type;
    while (t !== null && (t.type === "pointer_type" || t.type === "parenthesized_type")) t = t.namedChildren[0] ?? null;
    if (t === null) return null;
    if (t.type === "generic_type") t = t.childForFieldName("type");
    if (t === null) return null;
    if (t.type === "qualified_type") return t.childForFieldName("name")?.text ?? null;
    return t.type === "type_identifier" ? t.text : null;
}

/** The type specs of a type declaration, and the const/var specs of a const or var declaration, in order. */
function specsOf(declaration: Node): Node[] {
    if (declaration.type === "type_declaration") return declaration.namedChildren.filter((c): c is Node => c !== null && (c.type === "type_spec" || c.type === "type_alias"));
    if (declaration.type === "const_declaration") return childrenOfType(declaration, "const_spec");
    // a var declaration holds its specs directly, or in a var_spec_list when parenthesized
    return declaration.namedChildren.flatMap((c) => (c === null ? [] : c.type === "var_spec" ? [c] : c.type === "var_spec_list" ? childrenOfType(c, "var_spec") : []));
}

const specName = (spec: Node): string | null => spec.childForFieldName("name")?.text ?? null;

/** What a type spec declares: a struct, an interface, or any other type (aliases included). */
function typeKindOf(spec: Node): "struct" | "interface" | "type" {
    if (spec.type !== "type_spec") return "type";
    const type = spec.childForFieldName("type")?.type;
    return type === "struct_type" ? "struct" : type === "interface_type" ? "interface" : "type";
}

/** Exported: an upper-case first letter (the plan; Go's unicode.IsUpper). */
const isExported = (name: string): boolean => /^\p{Lu}/u.test(name);

/** The names a file declares at its top level: funcs (not methods), types, vars and consts, `_` left out. */
function topLevelNames(root: Node): string[] {
    const names: string[] = [];
    for (const node of root.namedChildren){
        if (node === null) continue;
        if (node.type === "function_declaration"){
            const name = node.childForFieldName("name")?.text;
            if (name !== undefined) names.push(name);
        } else if (node.type === "type_declaration"){
            for (const spec of specsOf(node)){
                const name = specName(spec);
                if (name !== null) names.push(name);
            }
        } else if (node.type === "const_declaration" || node.type === "var_declaration"){
            for (const spec of specsOf(node)) names.push(...identifiersOf(spec, "name"));
        }
    }
    return names.filter((n) => n !== "_");
}

/** A node the specifier walk still has to read, with the names bound where it sits (null outside any function). */
type Visit = { node: Node; bound: ReadonlySet<string> | null };

/** A node's children in the given fields, in order, each to be read under `bound`. */
function fieldVisits(node: Node, fields: readonly string[], bound: ReadonlySet<string> | null): Visit[] {
    return fields.flatMap((f) => node.childrenForFieldName(f).map((child) => ({ node: child, bound })));
}

/**
 * The file's specifiers in source order, each once. A node inside an ERROR is read as nothing: a malformed construct
 * gives no specifier rather than a guess.
 *
 * One pre-order walk with an explicit stack, not recursion (B-I1): a long chain of `+`, a long builder chain or a long
 * `else if` nests deeper than the call stack goes. Each node either records what it is and lists the children to read
 * next (pushed in reverse, so they pop in source order), or reads what it needs itself and lists none.
 */
function readSpecifiers(root: Node, topLevel: ReadonlySet<string>): { specifiers: string[]; importLines: string[] } {
    const specifiers = new Set<string>();
    const importLines: string[] = [];
    const free = (name: string, bound: ReadonlySet<string> | null): boolean =>
        name !== "" && !topLevel.has(name) && !(bound?.has(name) ?? false);
    const name = (node: Node, bound: ReadonlySet<string> | null): void => {
        const text = node.text;
        if (node.isMissing || text === "_" || PREDECLARED.has(text) || !free(text, bound)) return;
        specifiers.add(`name:${text}`);
    };

    const stack: Visit[] = [];
    const next = (visits: readonly Visit[]): void => {
        for (let i = visits.length - 1; i >= 0; i--) stack.push(visits[i]);
    };
    next(root.namedChildren.map((node) => ({ node, bound: null })));

    while (stack.length > 0){
        const { node, bound } = stack.pop()!;
        if (node.isError || node.isMissing) continue;

        switch (node.type){
            case "comment":
            case "package_clause":
            case "field_identifier":
            case "package_identifier":
            case "label_name":
                continue;

            case "import_spec": {
                if (node.hasError) continue;
                const path = stringContent(node.childForFieldName("path"));
                if (path === null) continue;
                specifiers.add(importSpecifier(path, node.childForFieldName("name")?.text ?? null));
                importLines.push(`import ${node.text.trim()}`);
                continue;
            }

            // the outermost function, method or top-level function literal: its bindings hold for everything in it
            case "function_declaration":
            case "method_declaration":
                next(fieldVisits(node, ["type_parameters", "receiver", "parameters", "result", "body"], bindingsOf(node)));
                continue;
            case "func_literal":
                next(fieldVisits(node, ["parameters", "result", "body"], bound ?? bindingsOf(node)));
                continue;

            // G-8: a generic type's type parameters are bound inside its own spec
            case "type_spec":
            case "type_alias": {
                const params = node.childForFieldName("type_parameters");
                const scope = params === null ? bound : new Set([...(bound ?? []), ...params.descendantsOfType("type_parameter_declaration")
                    .flatMap((d) => identifiersOf(d, "name"))]);
                next(fieldVisits(node, ["type_parameters", "type"], scope));
                continue;
            }

            case "selector_expression": {
                const operand = node.childForFieldName("operand");
                const member = node.childForFieldName("field");
                if (operand !== null && operand.type === "identifier" && !operand.isMissing && member !== null && !member.isMissing){
                    if (free(operand.text, bound)) specifiers.add(`use:${operand.text}.${member.text}`);
                    continue;   // a bound or top-level operand is no reference, and a free one is read through its use:
                }
                if (operand !== null) next([{ node: operand, bound }]);
                continue;
            }
            case "qualified_type": {
                const pkg = node.childForFieldName("package");
                const member = node.childForFieldName("name");
                if (pkg !== null && member !== null && !pkg.isMissing && !member.isMissing && free(pkg.text, bound)) specifiers.add(`use:${pkg.text}.${member.text}`);
                continue;
            }

            // declaration sites are never names (G-4): walk only the parts that are types or values
            case "parameter_declaration":
            case "variadic_parameter_declaration":
            case "field_declaration":
            case "type_parameter_declaration":
                next(fieldVisits(node, ["type"], bound));
                continue;
            case "const_spec":
            case "var_spec":
                next(fieldVisits(node, ["type", "value"], bound));
                continue;

            // a keyed element's key is a field name or a map key: a bare identifier there is no reference
            case "keyed_element": {
                const key = node.childForFieldName("key");
                const keyExpression = key?.namedChildren[0] ?? null;
                const readKey = key !== null && !(key.namedChildCount === 1 && keyExpression?.type === "identifier");
                next([...(readKey ? [{ node: key, bound }] : []), ...fieldVisits(node, ["value"], bound)]);
                continue;
            }

            case "identifier":
            case "type_identifier":
                name(node, bound);
                continue;
        }
        next(node.namedChildren.map((child) => ({ node: child, bound })));
    }
    return { specifiers: [...specifiers], importLines };
}

type GoSymbols = { symbols: SymbolRow[]; declarations: Declaration[] };

/**
 * The symbols (top-level declarations and the members of top-level types, in source order, each spec on its own lines,
 * G-3) and the chunk declarations (one per top-level declaration, over its attached comments).
 */
function readDeclarations(root: Node): GoSymbols {
    const symbols: SymbolRow[] = [];
    const declarations: Declaration[] = [];
    /** `ownerExported`: ADR-065's one export rule, a member is exported only when its owner is too. */
    const add = (name: string, kind: SymbolKind, node: Node, parent: string | null, ownerExported = true): void => {
        if (name === "_" || name === "") return;
        symbols.push({
            name, qualifiedName: parent === null ? name : `${parent}.${name}`, kind,
            startLine: startLineOf(node), endLine: endLineOf(node), exported: ownerExported && isExported(name), parentQualifiedName: parent,
        });
    };

    // A method sits outside its type, often in another file of the package, so only a receiver type this file declares
    // can gate it (the parse sees one file); a field or an interface method always sits inside its type.
    const declaredTypes = new Set<string>();
    for (const node of root.namedChildren){
        if (node.type !== "type_declaration") continue;
        for (const spec of specsOf(node)){
            const name = specName(spec);
            if (name !== null) declaredTypes.add(name);
        }
    }
    const receiverAllows = (parent: string | null): boolean => parent === null || !declaredTypes.has(parent) || isExported(parent);

    for (const node of root.namedChildren){
        if (node === null || !TOP_LEVEL_DECLARATIONS.has(node.type)) continue;
        const names: string[] = [];
        let exported = false;
        let chunkKind: Declaration["kind"] = "const";

        if (node.type === "function_declaration"){
            const name = node.childForFieldName("name")?.text ?? "";
            add(name, "function", node, null);
            names.push(name);
            chunkKind = "function";
        } else if (node.type === "method_declaration"){
            const name = node.childForFieldName("name")?.text ?? "";
            const parent = receiverName(node);
            add(name, "method", node, parent, receiverAllows(parent));
            names.push(parent === null ? name : `${parent}.${name}`);
            exported = receiverAllows(parent) && isExported(name);
            chunkKind = "function";
        } else if (node.type === "type_declaration"){
            const kinds = new Set<string>();
            for (const spec of specsOf(node)){
                const name = specName(spec);
                if (name === null) continue;
                const kind = typeKindOf(spec);
                kinds.add(kind);
                names.push(name);
                add(name, kind, spec, null);
                const type = spec.childForFieldName("type");
                if (kind === "struct" && type !== null){
                    for (const fields of childrenOfType(type, "field_declaration_list")){
                        for (const member of childrenOfType(fields, "field_declaration")){
                            const memberNames = member.childrenForFieldName("name").filter((c): c is Node => c !== null).map((c) => c.text);
                            const embedded = memberNames.length === 0 ? embeddedName(member.childForFieldName("type")) : null;
                            for (const memberName of embedded === null ? memberNames : [embedded]) add(memberName, "property", member, name, isExported(name));
                        }
                    }
                } else if (kind === "interface" && type !== null){
                    for (const method of childrenOfType(type, "method_elem")) add(method.childForFieldName("name")?.text ?? "", "method", method, name, isExported(name));
                }
            }
            // the chunk kinds of the plan's common rules: a struct is a class; a group of mixed kinds is a type
            chunkKind = kinds.size === 1 && kinds.has("struct") ? "class" : kinds.size === 1 && kinds.has("interface") ? "interface" : "type";
        } else{
            for (const spec of specsOf(node)){
                const specNames = identifiersOf(spec, "name");
                names.push(...specNames);
                for (const name of specNames) add(name, "const", spec, null);
            }
            chunkKind = "const";
        }

        if (names.length === 0 || names.every((n) => n === "")) continue;
        const span = leadingSpan(node, isLeadingComment);
        declarations.push({ kind: chunkKind, name: names.join(", "), ...span, exported: exported || (node.type !== "method_declaration" && names.some(isExported)) });
    }
    return { symbols, declarations };
}

/**
 * A comment above a declaration belongs to it, unless it trails the code before it on that code's last line
 * (`x := 1 // note`), which makes it that code's comment.
 */
function isLeadingComment(previous: Node): boolean {
    if (previous.type !== "comment") return false;
    const before = previous.previousSibling;
    return before === null || before.type === "comment" || endLineOf(before) < startLineOf(previous);
}

/** A spec line of the scan: `name "path"`, `. "path"`, `_ "path"` or `"path"` (either kind of quotes). */
const SCAN_SPEC = /^(?:([\p{L}_][\p{L}\p{N}_]*|\.)\s+)?(?:"([^"\\]+)"|`([^`]+)`)/u;

/**
 * The scan reading (a file over the parse cap): import specs read line by line, with no tree. It reads
 * `import "x"`, `import name "x"` and each line of an `import ( … )` block, skips comments, and stops at the first
 * declaration (Go puts every import before them), so it never meets the code's `pkg.Name` uses: those are the
 * reading's deliberate difference from a full parse.
 */
export function scanImports(text: string): string[] {
    const found = new Set<string>();
    const add = (line: string): void => {
        const spec = SCAN_SPEC.exec(line);
        if (spec !== null) found.add(importSpecifier(spec[2] ?? spec[3], spec[1] ?? null));
    };
    let inBlock = false;
    let inComment = false;
    for (const raw of withoutBom(text).split("\n")){
        let line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (inComment){
            const end = line.indexOf("*/");
            if (end === -1) continue;
            inComment = false;
            line = line.slice(end + 2);
        }
        line = line.replace(/\/\/.*$/, "").trim();
        if (line.startsWith("/*")){
            if (!line.includes("*/")) inComment = true;
            continue;
        }
        if (line === "") continue;
        if (inBlock){
            if (line.startsWith(")")){
                inBlock = false;
                continue;
            }
            add(line);
            continue;
        }
        const block = /^import\s*\((.*)$/.exec(line);
        if (block !== null){
            const rest = block[1].trim();
            if (rest.endsWith(")")) add(rest.slice(0, -1).trim());
            else{
                inBlock = true;
                if (rest !== "") add(rest);
            }
            continue;
        }
        const single = /^import\s+(.*)$/.exec(line);
        if (single !== null){
            add(single[1].trim());
            continue;
        }
        if (/^(func|type|var|const)\b/.test(line)) break;
    }
    return [...found];
}

/** One Go file's products in a reading. A syntax error is parsed around (tree-sitter's ERROR nodes give nothing). */
export function parseGo(path: string, text: string, reading: Reading): ParsedFile {
    const lineCount = countLines(withoutBom(text));
    if (reading === "scan"){
        return { chunks: [], symbols: [], imports: scanImports(text), declares: [], calls: emptyCallFacts(), lineCount };
    }

    return parseTree("go", text, (root) => {
        const names = topLevelNames(root);
        const topLevel = new Set(names);
        const { specifiers, importLines } = readSpecifiers(root, topLevel);

        const packageName = childrenOfType(root, "package_clause")[0]?.namedChildren.find((c) => c !== null && c.type === "package_identifier")?.text ?? null;
        const declares = [...new Set([...(packageName === null ? [] : [`package:${packageName}`]), ...names.filter((n) => n !== "init")])].sort();

        let chunks: CodeChunk[] = [];
        let symbols: SymbolRow[] = [];
        if (reading === "full"){
            const read = readDeclarations(root);
            symbols = read.symbols;
            // the summary names kinds as chunks do (the plan's chunk-kind mapping, B-M1): a struct is a class, as in C# and Rust
            const exports = symbols.filter((s) => s.parentQualifiedName === null && s.exported)
                .map((s) => `${s.name} (${s.kind === "struct" ? "class" : s.kind})`);
            chunks = assembleChunks(path, text, read.declarations, { imports: importLines, exports });
        }
        return { chunks, symbols, imports: specifiers, declares, calls: emptyCallFacts(), lineCount };
    });
}
