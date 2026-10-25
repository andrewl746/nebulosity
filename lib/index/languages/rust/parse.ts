import type { Node } from "web-tree-sitter";
import type { ChunkKind } from "../../../contracts";
import type { SymbolKind, SymbolRow } from "../../../db/schema";
import type { ParsedFile, Reading } from "../adapter";
import { assembleChunks, type Declaration } from "../chunking";
import { endLineOf, leadingSpan, parseTree, startLineOf, withoutBom } from "../treesitter";
import { countLines } from "../typescript";
import { emptyCallFacts } from "../typescript-calls";
import { scanRust } from "./scan";
import { joinPath, modSpecifier, pathSpecifier, STANDARD_CRATES, unraw, specifierForUse } from "./syntax";

/**
 * One Rust file's products (the E4 plan's Task R), from one tree-sitter parse:
 * - imports: `mod`, `use`, `extern crate` and paths in code, in source order, each once (syntax.ts);
 * - declares: the file's `mod:` specifiers, sorted: the module tree other files' paths walk (resolve.ts);
 * - symbols: the top-level items, plus the fields of top-level structs and unions, the fns of traits and of impl blocks;
 * - chunks: one per top-level item, impl blocks included, with their attributes and outer doc comments.
 * The "parse" reading keeps imports and declares; the "scan" reading reads lines (scan.ts).
 */
export function parseRust(path: string, text: string, reading: Reading): ParsedFile {
    const lineCount = countLines(withoutBom(text));
    if (reading === "scan") return { chunks: [], symbols: [], imports: scanRust(text), declares: [], calls: emptyCallFacts(), lineCount };

    return parseTree("rust", text, (root) => {
        const imports = new Set<string>();
        collectReferences(root, [], imports);
        const declares = [...imports].filter((s) => s.startsWith("mod:")).sort();
        if (reading === "parse") return { chunks: [], symbols: [], imports: [...imports], declares, calls: emptyCallFacts(), lineCount };

        const { symbols, declarations, summaryImports } = collectItems(root);
        return {
            chunks: assembleChunks(path, text, declarations, {
                imports: summaryImports,
                exports: declarations.filter((d) => d.exported).map((d) => `${d.name} (${d.kind})`),
            }),
            symbols,
            imports: [...imports],
            declares,
            calls: emptyCallFacts(),
            lineCount,
        };
    });
}

/* ─────────────────────────────── references ─────────────────────────────── */

/** Every reference under `node`, in source order, with the inline-module path it sits in. */
function collectReferences(node: Node, inline: readonly string[], out: Set<string>): void {
    switch (node.type){
        case "use_declaration": {
            if (node.hasError) return;   // a malformed use gives no specifier rather than a guess
            const argument = node.childForFieldName("argument");
            if (argument !== null) for (const leaf of leavesOfUseTree(argument, "", false)) out.add(specifierForUse(inline, leaf));
            return;
        }
        case "mod_item": {
            const name = node.childForFieldName("name");
            if (name === null || name.isMissing) return;
            const body = node.childForFieldName("body");
            if (body === null) out.add(modSpecifier(inline, name.text, pathAttributeOf(node)));
            else for (const child of body.namedChildren) collectReferences(child, [...inline, name.text], out);
            return;
        }
        case "extern_crate_declaration": {
            const name = node.childForFieldName("name");
            if (name !== null && !name.isMissing) out.add(`extern:${unraw(name.text)}`);
            return;
        }
        case "visibility_modifier":
            return;   // pub(in crate::a) restricts visibility; it refers to nothing
        case "scoped_identifier":
        case "scoped_type_identifier": {
            const segments = codeSegments(node);
            if (segments !== null && !node.hasError){
                const named = segments[0] === "" ? segments.slice(1) : segments;
                if (named.length >= 2 && !STANDARD_CRATES.has(named[0]) && !named[0].startsWith("$")) out.add(pathSpecifier(inline, segments.join("::")));
            }
            collectWithinChain(node.childForFieldName("path"), inline, out);
            return;
        }
        default:
            for (const child of node.namedChildren) collectReferences(child, inline, out);
    }
}

/**
 * Inside a path's own chain (its `path` field, down to the first segment) only the generic arguments hold further
 * references: `crate::a::Wrapper<crate::b::Thing>` gives two paths, `crate::a` (the inner chain) gives none of its own.
 */
function collectWithinChain(node: Node | null, inline: readonly string[], out: Set<string>): void {
    if (node === null) return;
    if (node.type === "scoped_identifier" || node.type === "scoped_type_identifier") collectWithinChain(node.childForFieldName("path"), inline, out);
    else if (node.type === "generic_type"){
        collectWithinChain(node.childForFieldName("type"), inline, out);
        const args = node.childForFieldName("type_arguments");
        if (args !== null) collectReferences(args, inline, out);
    } else if (node.type === "bracketed_type") collectReferences(node, inline, out);   // <T as crate::a::Tr>::x: the trait's path
}

/** A code path's segments without generic arguments (`Vec::<u8>::new` → Vec, new), "" first for a leading `::`; null for `<T as Tr>::x`. */
function codeSegments(node: Node): string[] | null {
    switch (node.type){
        case "scoped_identifier":
        case "scoped_type_identifier": {
            const name = node.childForFieldName("name");
            if (name === null || name.isMissing) return null;
            const path = node.childForFieldName("path");
            const head = path === null ? [""] : codeSegments(path);
            return head === null ? null : [...head, name.text];
        }
        case "generic_type": {
            const type = node.childForFieldName("type");
            return type === null ? null : codeSegments(type);
        }
        case "identifier":
        case "type_identifier":
        case "crate":
        case "self":
        case "super":
        case "metavariable":
            return node.isMissing ? null : [node.text];
        default:
            return null;
    }
}

/** A use-tree path as written: `crate::a::b`, `::std::x` (a leading `::` kept). */
function textOfUsePath(node: Node): string {
    if (node.type !== "scoped_identifier") return node.text;
    const name = node.childForFieldName("name")?.text ?? "";
    const path = node.childForFieldName("path");
    return path === null ? `::${name}` : `${textOfUsePath(path)}::${name}`;
}

/** The leaves of a use tree: groups expanded, `self` in a group its prefix, a glob `<prefix>::*`, a rename `<path> as <alias>`. */
function leavesOfUseTree(node: Node, prefix: string, inGroup: boolean): string[] {
    switch (node.type){
        case "use_list":
            return node.namedChildren.flatMap((child) => leavesOfUseTree(child, prefix, true));
        case "scoped_use_list": {
            const path = node.childForFieldName("path");
            const list = node.childForFieldName("list");
            return list === null ? [] : leavesOfUseTree(list, path === null ? prefix : joinPath(prefix, textOfUsePath(path)), false);
        }
        case "use_wildcard": {
            const path = node.namedChildren[0];
            return [`${path === undefined ? prefix : joinPath(prefix, textOfUsePath(path))}::*`];
        }
        case "use_as_clause": {
            const path = node.childForFieldName("path");
            const alias = node.childForFieldName("alias");
            if (path === null || alias === null) return [];
            const full = path.type === "self" && inGroup ? prefix : joinPath(prefix, textOfUsePath(path));
            return full === "" ? [] : [`${full} as ${alias.text}`];
        }
        default: {
            const full = node.type === "self" && inGroup ? prefix : joinPath(prefix, textOfUsePath(node));
            return full === "" ? [] : [full];
        }
    }
}

/** The file `#[path = "…"]` names for a `mod x;`, from the attributes just above it (comments between them allowed). */
function pathAttributeOf(mod: Node): string | null {
    for (let previous = mod.previousSibling; previous !== null; previous = previous.previousSibling){
        if (isComment(previous)) continue;
        if (previous.type !== "attribute_item") return null;
        const attribute = previous.namedChildren[0];
        const value = attribute?.childForFieldName("value");
        if (attribute?.namedChildren[0]?.type === "identifier" && attribute.namedChildren[0].text === "path" && value?.type === "string_literal"){
            return value.namedChildren.find((c) => c.type === "string_content")?.text ?? "";
        }
    }
    return null;
}

/* ─────────────────────────────── items: symbols and chunks ─────────────────────────────── */

const isComment = (node: Node): boolean => node.type === "line_comment" || node.type === "block_comment";
// A `///` line or a `/**` block: an outer doc comment, which documents the item below it (`//!` documents the module
// it sits in, so it never attaches).
const isOuterDoc = (node: Node): boolean => isComment(node) && node.childForFieldName("outer") !== null;

/** What a chunk carries above its item: attributes and outer doc comments, with no blank line between. */
const chunkSpan = (node: Node) => leadingSpan(node, (previous) => previous.type === "attribute_item" || isOuterDoc(previous));

/**
 * A symbol's lines: from its first attached `#[…]` to its last line, its comments left out (as TypeScript's getStart
 * includes decorators but not the doc comment). Comments between the attributes and the item don't detach them.
 */
function symbolLines(node: Node): { startLine: number; endLine: number } {
    let startLine = startLineOf(node);
    let top = startLine;
    for (let previous = node.previousSibling; previous !== null && (previous.type === "attribute_item" || isComment(previous)); previous = previous.previousSibling){
        if (endLineOf(previous) < top - 1) break;
        top = Math.min(top, startLineOf(previous));
        if (previous.type === "attribute_item") startLine = top;
    }
    return { startLine, endLine: endLineOf(node) };
}

/** Exported means the item's own visibility is exactly `pub` (not `pub(crate)`, not none). */
const isPub = (node: Node): boolean => node.namedChildren.some((c) => c.type === "visibility_modifier" && c.text === "pub");

/** A type's base name: `Foo` for Foo, Foo<T>, a::Foo, &Foo, &mut a::Foo<T>; its text without spaces otherwise ([T], dyn Tr). */
function baseName(node: Node | null): string {
    if (node === null) return "";
    switch (node.type){
        case "type_identifier":
        case "identifier":
        case "primitive_type":
            return node.text;
        case "generic_type":
            return baseName(node.childForFieldName("type"));
        case "scoped_type_identifier":
        case "scoped_identifier":
            return node.childForFieldName("name")?.text ?? node.text;
        case "reference_type":
        case "pointer_type":
            return baseName(node.childForFieldName("type"));
        default:
            return node.text.replace(/\s+/g, " ");
    }
}

/** The kinds a top-level item gives: its symbol kind and its chunk kind (the plan's common chunk-kind mapping). */
const ITEM_KINDS: Record<string, { symbol: SymbolKind; chunk: ChunkKind }> = {
    function_item: { symbol: "function", chunk: "function" },
    struct_item: { symbol: "struct", chunk: "class" },
    union_item: { symbol: "struct", chunk: "class" },
    enum_item: { symbol: "enum", chunk: "enum" },
    trait_item: { symbol: "trait", chunk: "interface" },
    type_item: { symbol: "type", chunk: "type" },
    const_item: { symbol: "const", chunk: "const" },
    static_item: { symbol: "const", chunk: "const" },
    mod_item: { symbol: "namespace", chunk: "namespace" },
    macro_definition: { symbol: "function", chunk: "function" },
};

/** The top-level items' symbols (with their members) and chunk declarations, and the summary's import lines. */
function collectItems(root: Node): { symbols: SymbolRow[]; declarations: Declaration[]; summaryImports: string[] } {
    const symbols: SymbolRow[] = [];
    const declarations: Declaration[] = [];
    const summaryImports: string[] = [];
    const symbol = (node: Node, name: string, kind: SymbolKind, exported: boolean, parent: string | null): void => {
        symbols.push({ name, qualifiedName: parent === null ? name : `${parent}.${name}`, kind, ...symbolLines(node), exported, parentQualifiedName: parent });
    };
    const methods = (body: Node | null, parent: string): void => {
        for (const member of body?.namedChildren ?? []){
            if (member.type !== "function_item" && member.type !== "function_signature_item") continue;
            const name = member.childForFieldName("name");
            if (name !== null && !name.isMissing) symbol(member, name.text, "method", isPub(member), parent);
        }
    };

    for (const item of root.namedChildren){
        if (item.type === "use_declaration" || item.type === "extern_crate_declaration" || (item.type === "mod_item" && item.childForFieldName("body") === null)){
            summaryImports.push(item.text.replace(/\r\n/g, "\n").trim());
            continue;
        }
        if (item.type === "impl_item"){
            const self = baseName(item.childForFieldName("type"));
            const trait = item.childForFieldName("trait");
            methods(item.childForFieldName("body"), self);
            declarations.push({ kind: "class", name: trait === null ? `impl ${self}` : `impl ${baseName(trait)} for ${self}`, ...chunkSpan(item), exported: false });
            continue;
        }
        const kinds = ITEM_KINDS[item.type];
        const name = item.childForFieldName("name");
        if (kinds === undefined || name === null || name.isMissing) continue;

        const exported = item.type !== "macro_definition" && isPub(item);
        symbol(item, name.text, kinds.symbol, exported, null);
        if (item.type === "struct_item" || item.type === "union_item"){
            const body = item.childForFieldName("body");
            for (const field of body?.type === "field_declaration_list" ? body.namedChildren : []){
                const fieldName = field.type === "field_declaration" ? field.childForFieldName("name") : null;
                if (fieldName !== null && !fieldName.isMissing) symbol(field, fieldName.text, "property", isPub(field), name.text);
            }
        } else if (item.type === "trait_item") methods(item.childForFieldName("body"), name.text);
        declarations.push({ kind: kinds.chunk, name: name.text, ...chunkSpan(item), exported });
    }
    return { symbols, declarations, summaryImports };
}
