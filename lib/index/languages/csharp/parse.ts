/**
 * Reading one C# file (the E4 plan's Task C, ADR-065): one tree-sitter parse gives its specifiers, its declares, its
 * symbols and its chunks. Two passes over the tree:
 * - the declaration pass walks only the file's structure (usings, namespaces, types and their members): the using and
 *   namespace specifiers, the declares, the symbols and the chunks;
 * - the reference walk visits every node with one tree cursor and collects the names the code uses: type names in type
 *   positions, static access `N.Member`, `nameof(N)`, attributes, qualified names.
 * Each specifier remembers where its name starts, so the file's list comes out in source order whichever pass found it.
 *
 * The specifier syntax (the plan's table): using:A.B, global:A.B, static:A.B.C, gstatic:A.B.C, alias:X=A.B.C,
 * galias:X=A.B.C, ns:A.B, type:N, qtype:A.B.N. Declares: type:<namespace>.<Type>[.<Nested>], main:static,
 * main:top-level, and the file's project-wide usings (C18).
 *
 * Extension-method calls are not read (the controller's ruling of 2026-10-25, amending the plan's ext:): C# binds `x.M(…)`
 * to an applicable instance method or overload first, so linking one needs the receiver's and the arguments' types. By
 * name alone, 19 of 30 sampled links on jellyfin were right (progress-csharp.md, round 2).
 */
import type { Node, TreeCursor } from "web-tree-sitter";
import type { ChunkKind } from "../../../contracts";
import type { SymbolKind, SymbolRow } from "../../../db/schema";
import type { ParsedFile, Reading } from "../adapter";
import { assembleChunks, type Declaration } from "../chunking";
import { endLineOf, leadingSpan, parseTree, startLineOf } from "../treesitter";
import { countLines } from "../typescript";
import { emptyCallFacts } from "../typescript-calls";
import { scanCsharp } from "./scan";

/** Every leading byte-order mark (a file saved twice by a careless tool can carry two; parseTree drops only one). */
export function withoutBoms(text: string): string {
    let start = 0;
    while (text.charCodeAt(start) === 0xfeff) start++;
    return start === 0 ? text : text.slice(start);
}

/** A type declaration's symbol kind (C5): a record is a class, a record struct a struct, a delegate a type. */
const TYPE_DECLARATIONS: Record<string, SymbolKind> = {
    class_declaration: "class",
    struct_declaration: "struct",
    interface_declaration: "interface",
    enum_declaration: "enum",
    record_declaration: "class",
    delegate_declaration: "type",
};

/** The coarse chunk kind every language shares (the plan's common rules): structs and records are classes. */
const CHUNK_KIND: Record<SymbolKind, ChunkKind> = {
    function: "function", class: "class", method: "function", property: "const", accessor: "function", constructor: "function",
    interface: "interface", type: "type", enum: "enum", const: "const", namespace: "namespace", struct: "class", trait: "interface",
};

/** #if/#elif/#else blocks: their declarations belong to the block's parent. */
const PREPROCESSOR_BLOCKS = new Set(["preproc_if", "preproc_elif", "preproc_else"]);

/** Contextual keywords that reach a type position as plain identifiers: never a type of the repo's. */
const NOT_TYPE_NAMES = new Set(["dynamic", "notnull", "unmanaged", "nint", "nuint", "var", "managed"]);

const UPPER_CASE = /^\p{Lu}/u;

/** A name as written, without the `@` that lets a keyword be an identifier. */
function plain(name: string): string {
    return name.startsWith("@") ? name.slice(1) : name;
}

/**
 * A name's dotted text: generic arguments dropped (`List<Item>` → List), an alias qualifier dropped (`global::System.Text`
 * → System.Text). Anything else is its text without whitespace.
 */
export function dottedName(node: Node): string {
    switch (node.type){
        case "identifier":
            return plain(node.text);
        case "generic_name":
            return node.firstNamedChild === null ? node.text : dottedName(node.firstNamedChild);
        case "qualified_name": {
            const qualifier = node.childForFieldName("qualifier");
            const name = node.childForFieldName("name");
            return qualifier === null || name === null ? node.text.replace(/\s+/g, "") : `${dottedName(qualifier)}.${dottedName(name)}`;
        }
        case "alias_qualified_name": {
            const name = node.childForFieldName("name");
            return name === null ? node.text.replace(/\s+/g, "") : dottedName(name);
        }
        default:
            return node.text.replace(/\s+/g, "");
    }
}

function modifiersOf(node: Node): Set<string> {
    const out = new Set<string>();
    for (const child of node.namedChildren) if (child.type === "modifier") out.add(child.text);
    return out;
}

/** Members and declarations, with the ones inside #if/#elif/#else blocks lifted to their parent's level, in order. */
function flattened(nodes: readonly Node[]): Node[] {
    return nodes.flatMap((n) => (PREPROCESSOR_BLOCKS.has(n.type) ? flattened(n.namedChildren) : [n]));
}

const join = (outer: string, name: string): string => (outer === "" ? name : `${outer}.${name}`);

/**
 * Exported, for a member or a nested type (ADR-065's one rule for every language): only when its owner is exported and
 * it is `public` itself; an interface's members have no visibility of their own to read, so they take the interface's.
 */
function memberExported(member: Node, owner: { isInterface: boolean; exported: boolean }): boolean {
    return owner.isInterface ? owner.exported : owner.exported && modifiersOf(member).has("public");
}

type Found = { at: number; seq: number; specifier: string };

/** What the two passes collect. */
type FileFacts = {
    found: Found[];
    declares: Set<string>;
    symbols: SymbolRow[];
    declarations: Declaration[];
    usingTexts: string[];
    exports: string[];
    /** Simple names of every type the file declares, nested ones included. */
    declaredTypes: Set<string>;
    /** Every type parameter's name. */
    typeParameters: Set<string>;
    /** The file's locals, parameters, fields and properties, by name: what static access N.Member leaves out. */
    valueNames: Set<string>;
    /** Candidates a type position gave (left out when the file declares the name or it is a type parameter). */
    typeNames: Found[];
    /** Candidates static access, nameof or a constant pattern gave (left out for the file's values too). */
    staticNames: Found[];
};

/** The using directive's specifier, or null for a malformed one. */
export function usingSpecifier(node: Node): string | null {
    // tree-sitter repairs `using X = ;` into a using of X: a malformed construct gives no specifier rather than a guess
    if (node.hasError) return null;
    let isGlobal = false;
    let isStatic = false;
    for (let i = 0; i < node.childCount; i++){
        const child = node.child(i);
        if (child === null || child.isNamed) continue;
        if (child.type === "global") isGlobal = true;
        else if (child.type === "static") isStatic = true;
    }
    const alias = node.childForFieldName("name");
    const target = node.namedChildren.find((c) => c.type !== "comment" && (alias === null || c.startIndex !== alias.startIndex));
    if (target === undefined) return null;
    const name = dottedName(target);
    if (name === "") return null;
    if (alias !== null) return `${isGlobal ? "galias" : "alias"}:${plain(alias.text)}=${name}`;
    if (isStatic) return `${isGlobal ? "gstatic" : "static"}:${name}`;
    return `${isGlobal ? "global" : "using"}:${name}`;
}

/** The declaration pass: usings, namespaces and types at file or namespace level, and each top-level type's members. */
function readStructure(root: Node, facts: FileFacts): void {
    let seq = 0;
    const emit = (at: number, specifier: string): void => {
        facts.found.push({ at, seq: seq++, specifier });
    };

    const type = (node: Node, namespace: string, outer: readonly string[], depth: number, parent: { name: string; isInterface: boolean; exported: boolean } | null): void => {
        const nameNode = node.childForFieldName("name");
        if (nameNode === null) return;
        const name = plain(nameNode.text);
        let kind = TYPE_DECLARATIONS[node.type];
        if (node.type === "record_declaration"){
            for (let i = 0; i < node.childCount; i++) if (node.child(i)?.type === "struct") kind = "struct";
        }
        const fullName = join(namespace, [...outer, name].join("."));
        facts.declares.add(`type:${fullName}`);
        facts.declaredTypes.add(name);

        // ADR-065's one export rule: a nested type only when its owner is exported too; an interface's members take its flag
        const exported = parent === null ? modifiersOf(node).has("public") : memberExported(node, parent);
        if (depth <= 1){
            facts.symbols.push({
                name, qualifiedName: parent === null ? name : `${parent.name}.${name}`, kind,
                startLine: startLineOf(node), endLine: endLineOf(node), exported, parentQualifiedName: parent?.name ?? null,
            });
        }
        if (depth === 0){
            const span = leadingSpan(node, (previous) => previous.type === "comment");
            facts.declarations.push({ kind: CHUNK_KIND[kind], name, startLine: span.startLine, endLine: span.endLine, exported });
            if (exported) facts.exports.push(`${name} (${CHUNK_KIND[kind]})`);
        }

        const body = node.childForFieldName("body");
        if (body === null) return;
        const self = { name, isInterface: kind === "interface", exported };
        for (const member of flattened(body.namedChildren)){
            if (member.type in TYPE_DECLARATIONS){
                // a nested type is a symbol only as a top-level type's member (depth 1); deeper ones only declare
                type(member, namespace, [...outer, name], depth + 1, self);
                continue;
            }
            if (member.type === "method_declaration" && plain(member.childForFieldName("name")?.text ?? "") === "Main"
                && modifiersOf(member).has("static")) facts.declares.add("main:static");
            if (depth === 0) memberSymbol(member, self);
        }
    };

    /** A top-level type's member as a symbol (one level only). */
    const memberSymbol = (member: Node, owner: { name: string; isInterface: boolean; exported: boolean }): void => {
        const add = (name: string, kind: SymbolKind): void => {
            facts.symbols.push({
                name, qualifiedName: `${owner.name}.${name}`, kind, startLine: startLineOf(member), endLine: endLineOf(member),
                exported: memberExported(member, owner), parentQualifiedName: owner.name,
            });
        };
        const named = (): string | null => {
            const n = member.childForFieldName("name");
            return n === null ? null : plain(n.text);
        };
        switch (member.type){
            case "method_declaration": { const n = named(); if (n !== null) add(n, "method"); break; }
            case "constructor_declaration": { const n = named(); if (n !== null) add(n, "constructor"); break; }
            case "property_declaration":
            case "event_declaration": { const n = named(); if (n !== null) add(n, "property"); break; }
            case "indexer_declaration": add("this", "accessor"); break;
            case "field_declaration":
            case "event_field_declaration": {
                const declaration = member.namedChildren.find((c) => c.type === "variable_declaration");
                for (const declarator of declaration?.namedChildren ?? []){
                    const n = declarator.type === "variable_declarator" ? declarator.childForFieldName("name") : null;
                    if (n !== null) add(plain(n.text), "property");
                }
                break;
            }
            default:
                break;   // operators, conversions, destructors, enum members: no symbol
        }
    };

    const container = (node: Node, namespace: string): void => {
        let current = namespace;   // a file-scoped namespace holds the declarations after it
        for (const child of flattened(node.namedChildren)){
            switch (child.type){
                case "using_directive": {
                    const specifier = usingSpecifier(child);
                    if (specifier !== null){
                        emit(child.startIndex, specifier);
                        if (/^(global|gstatic|galias):/.test(specifier)) facts.declares.add(specifier);
                        // the summary's line, as written, with no "\r" from a multi-line using: a CRLF checkout's summary
                        // is an LF one's (B-M2); a malformed using is left out, as the other languages leave theirs
                        facts.usingTexts.push(child.text.replace(/\r/g, "").trim());
                    }
                    break;
                }
                case "file_scoped_namespace_declaration": {
                    const name = child.childForFieldName("name");
                    if (name !== null){
                        current = join(namespace, dottedName(name));
                        emit(child.startIndex, `ns:${current}`);
                    }
                    break;
                }
                case "namespace_declaration": {
                    const name = child.childForFieldName("name");
                    const body = child.childForFieldName("body");
                    if (name === null) break;
                    const full = join(current, dottedName(name));
                    emit(child.startIndex, `ns:${full}`);
                    if (body !== null) container(body, full);
                    break;
                }
                case "global_statement":
                    facts.declares.add("main:top-level");
                    break;
                default:
                    if (child.type in TYPE_DECLARATIONS) type(child, current, [], 0, null);
            }
        }
    };

    container(root, "");
}

const CODE = 0;
const TYPE = 1;
const QNAME = 2;
const GENERIC_METHOD = 3;
const SKIP = 4;

/** Nodes whose `name` field is a value the file declares: what static access leaves out. */
const VALUE_DECLARATIONS = new Set([
    "variable_declarator", "parameter", "property_declaration", "event_declaration", "declaration_expression", "declaration_pattern", "catch_declaration",
]);

/** How a child is read, given its parent's mode, its parent's type and the field it sits in. */
function childMode(parentMode: number, parentType: string, field: string | null, type: string, named: boolean): number {
    if (!named || type === "comment") return SKIP;
    switch (parentMode){
        case CODE:
            if (field === "name"){
                // a member's name: not a reference, but `x.M<T>(…)`'s type arguments are
                if (parentType === "member_access_expression" || parentType === "member_binding_expression") return type === "generic_name" ? GENERIC_METHOD : SKIP;
                return SKIP;   // declarations, namespaces, named arguments
            }
            if (field === "type" || field === "returns") return TYPE;
            if (field === "right" && (parentType === "as_expression" || parentType === "is_expression")) return TYPE;
            if (parentType === "base_list") return type === "argument_list" || type === "primary_constructor_base_type" ? CODE : TYPE;
            if (parentType === "type_argument_list" || parentType === "explicit_interface_specifier") return TYPE;
            if (type === "qualified_name" || type === "alias_qualified_name") return TYPE;
            if (type === "generic_name") return parentType === "invocation_expression" && field === "function" ? GENERIC_METHOD : TYPE;
            return CODE;
        case TYPE:
            switch (parentType){
                case "generic_name":
                    return type === "type_argument_list" ? CODE : SKIP;
                case "qualified_name":
                case "alias_qualified_name":
                    return type === "identifier" ? SKIP : QNAME;
                case "nullable_type":
                case "array_type":
                case "pointer_type":
                case "ref_type":
                case "scoped_type":
                    return field === "type" ? TYPE : CODE;
                case "identifier":
                case "predefined_type":
                case "implicit_type":
                    return SKIP;
                default:
                    return CODE;   // a tuple's elements, a function pointer's parameters, an ERROR
            }
        case QNAME:
            if (type === "type_argument_list") return CODE;
            return type === "identifier" ? SKIP : QNAME;
        case GENERIC_METHOD:
            return type === "type_argument_list" ? CODE : SKIP;
        default:
            return SKIP;
    }
}

/** The reference walk: one cursor over every node, a mode per depth. */
function readReferences(root: Node, facts: FileFacts): void {
    let seq = 1_000_000;   // after the structure pass's, though positions rarely tie across passes
    const typeName = (at: number, name: string): void => {
        facts.typeNames.push({ at, seq: seq++, specifier: name });
    };
    const staticName = (at: number, name: string): void => {
        facts.staticNames.push({ at, seq: seq++, specifier: name });
    };
    const emit = (at: number, specifier: string): void => {
        facts.found.push({ at, seq: seq++, specifier });
    };

    /** What entering a node emits; whether to read its children. */
    const enter = (cursor: TreeCursor, mode: number): boolean => {
        const type = cursor.nodeType;
        if (mode === QNAME || mode === GENERIC_METHOD) return true;
        if (mode === TYPE){
            switch (type){
                case "identifier":
                    typeName(cursor.startIndex, plain(cursor.nodeText));
                    return false;
                case "generic_name": {
                    const id = cursor.currentNode.firstNamedChild;
                    if (id !== null) typeName(id.startIndex, plain(id.text));
                    return true;
                }
                case "qualified_name":
                case "alias_qualified_name": {
                    const name = dottedName(cursor.currentNode);
                    if (name.includes(".")) emit(cursor.startIndex, `qtype:${name}`);
                    else typeName(cursor.startIndex, name);
                    return true;
                }
                case "predefined_type":
                case "implicit_type":
                    return false;
                default:
                    return true;
            }
        }
        switch (type){
            case "identifier":
            case "using_directive":   // read by the structure pass
                return false;
            case "attribute": {
                const name = cursor.currentNode.childForFieldName("name");
                if (name !== null){
                    const dotted = dottedName(name);
                    if (dotted.includes(".")){
                        emit(name.startIndex, `qtype:${dotted}`);
                        emit(name.startIndex, `qtype:${dotted}Attribute`);
                    } else{
                        typeName(name.startIndex, dotted);
                        typeName(name.startIndex, `${dotted}Attribute`);
                    }
                    if (name.type === "generic_name"){
                        // [Foo<Bar>]: its type arguments are types
                        const args = name.namedChildren.find((c) => c.type === "type_argument_list");
                        for (const arg of args?.namedChildren ?? []) if (arg.type === "identifier") typeName(arg.startIndex, plain(arg.text));
                    }
                }
                return true;
            }
            case "invocation_expression": {
                // nameof(N): N counts like a static access. An invoked member `x.M(…)` gives nothing (extension-method
                // calls aren't linked); its receiver and type arguments are read as the walk goes on.
                const node = cursor.currentNode;
                const fn = node.childForFieldName("function");
                if (fn?.type === "identifier" && fn.text === "nameof"){
                    const args = node.childForFieldName("arguments");
                    const only = args !== null && args.namedChildCount === 1 ? args.namedChild(0)?.namedChild(0) ?? null : null;
                    if (only?.type === "identifier") staticName(only.startIndex, plain(only.text));
                }
                return true;
            }
            case "member_access_expression": {
                const expression = cursor.currentNode.childForFieldName("expression");
                if (expression?.type === "identifier") staticName(expression.startIndex, plain(expression.text));
                return true;
            }
            case "constant_pattern": {
                // `o is Order`: a type test written as a constant pattern
                const only = cursor.currentNode.namedChildCount === 1 ? cursor.currentNode.namedChild(0) : null;
                if (only?.type === "identifier") staticName(only.startIndex, plain(only.text));
                return true;
            }
            case "type_parameter": {
                const name = cursor.currentNode.childForFieldName("name");
                if (name !== null) facts.typeParameters.add(plain(name.text));
                return true;
            }
            case "implicit_parameter":
                facts.valueNames.add(plain(cursor.nodeText));
                return false;
            case "foreach_statement": {
                const left = cursor.currentNode.childForFieldName("left");
                if (left?.type === "identifier") facts.valueNames.add(plain(left.text));
                return true;
            }
            default:
                if (VALUE_DECLARATIONS.has(type)){
                    const name = cursor.currentNode.childForFieldName("name");
                    if (name !== null) facts.valueNames.add(plain(name.text));
                }
                return true;
        }
    };

    const cursor = root.walk();
    try{
        const modes: number[] = [CODE];
        const types: string[] = [cursor.nodeType];
        let depth = 0;
        let descend = enter(cursor, CODE);
        for (;;){
            if (descend && cursor.gotoFirstChild()) depth++;
            else{
                let moved = false;
                while (depth > 0){
                    if (cursor.gotoNextSibling()){
                        moved = true;
                        break;
                    }
                    cursor.gotoParent();
                    depth--;
                }
                if (!moved) break;
            }
            const mode = childMode(modes[depth - 1], types[depth - 1], cursor.currentFieldName, cursor.nodeType, cursor.nodeIsNamed);
            modes[depth] = mode;
            types[depth] = cursor.nodeType;
            descend = mode !== SKIP && enter(cursor, mode);
        }
    } finally{
        cursor.delete();
    }
}

/** The file's specifiers in source order, each once: the found ones, plus the type and static names that survive. */
function specifiersOf(facts: FileFacts): string[] {
    const left = (name: string): boolean => facts.declaredTypes.has(name) || facts.typeParameters.has(name);
    const all: Found[] = [
        ...facts.found,
        ...facts.typeNames.filter((f) => !left(f.specifier) && !NOT_TYPE_NAMES.has(f.specifier)).map((f) => ({ ...f, specifier: `type:${f.specifier}` })),
        ...facts.staticNames.filter((f) => UPPER_CASE.test(f.specifier) && !left(f.specifier) && !facts.valueNames.has(f.specifier))
            .map((f) => ({ ...f, specifier: `type:${f.specifier}` })),
    ];
    all.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return [...new Set(all.map((f) => f.specifier))];
}

/**
 * One C# file's products. "full" gives all five; "parse" its specifiers and declares only; "scan" a line scan of its
 * using and namespace lines (scan.ts), with no tree. Every leading byte-order mark is dropped first.
 */
export function parseCsharp(path: string, raw: string, reading: Reading): ParsedFile {
    const text = withoutBoms(raw);
    if (reading === "scan") return { chunks: [], symbols: [], imports: scanCsharp(text), declares: [], calls: emptyCallFacts(), lineCount: countLines(text) };

    const facts: FileFacts = {
        found: [], declares: new Set(), symbols: [], declarations: [], usingTexts: [], exports: [],
        declaredTypes: new Set(), typeParameters: new Set(), valueNames: new Set(), typeNames: [], staticNames: [],
    };
    parseTree("csharp", text, (root) => {
        readStructure(root, facts);
        readReferences(root, facts);
    });

    const full = reading === "full";
    return {
        chunks: full ? assembleChunks(path, text, facts.declarations, { imports: facts.usingTexts, exports: facts.exports }) : [],
        symbols: full ? facts.symbols : [],
        imports: specifiersOf(facts),
        declares: [...facts.declares].sort(),
        calls: emptyCallFacts(),
        lineCount: countLines(text),
    };
}
