/**
 * Java's parse (ADR-065, the E4 plan's Task J): one tree-sitter parse gives a file's specifiers, declares, symbols and
 * chunks; the scan reading is a line scan of its import lines, with no tree.
 *
 * Java resolves by name, not by path, so a file's references are names:
 * - import:a.b.C, import:a.b.*, static:a.b.C (the class a static import reads from);
 * - type:C for each simple type name the file uses that no single-type import names and the file doesn't declare;
 * - qualified:a.b.C for a fully qualified type name written in code.
 * Its declares are the facts other files resolve those names against: package:a.b, type:a.b.C per top-level type, and
 * main:a.b.C for a top-level type with `public static void main(String[] …)`.
 */
import type { Node } from "web-tree-sitter";
import type { ChunkKind } from "../../../contracts";
import type { SymbolKind, SymbolRow } from "../../../db/schema";
import type { ParsedFile, Reading } from "../adapter";
import { assembleChunks, type Declaration } from "../chunking";
import { endLineOf, leadingSpan, parseTree, startLineOf, withoutBom } from "../treesitter";
import { countLines } from "../typescript";
import { emptyCallFacts } from "../typescript-calls";

/** The declarations that make a type, with the symbol kind and the chunk kind each one takes (the plan's mapping). */
const TYPE_KINDS: Record<string, { symbol: SymbolKind; chunk: ChunkKind }> = {
    class_declaration: { symbol: "class", chunk: "class" },
    record_declaration: { symbol: "class", chunk: "class" },
    interface_declaration: { symbol: "interface", chunk: "interface" },
    annotation_type_declaration: { symbol: "interface", chunk: "interface" },
    enum_declaration: { symbol: "enum", chunk: "enum" },
};

const UPPER_START = /^\p{Lu}/u;

/**
 * The specifier an import declaration gives, or null for a malformed one (no specifier rather than a guess). A static
 * import names the class it reads from: `import static a.b.C.m;` and `import static a.b.C.*;` are both static:a.b.C.
 */
export function importSpecifier(isStatic: boolean, segments: readonly string[], onDemand: boolean): string | null {
    if (segments.length === 0 || segments.some((s) => s === "")) return null;
    const name = segments.join(".");
    if (isStatic){
        if (onDemand) return `static:${name}`;
        return segments.length < 2 ? null : `static:${segments.slice(0, -1).join(".")}`;
    }
    return onDemand ? `import:${name}.*` : `import:${name}`;
}

/** An identifier or a scoped_identifier's segments (`a.b.C` → a, b, C), or null for anything else. */
function nameSegments(node: Node): string[] | null {
    if (node.type === "identifier") return [node.text];
    if (node.type !== "scoped_identifier") return null;
    const scope = node.childForFieldName("scope");
    const name = node.childForFieldName("name");
    if (scope === null || name === null) return null;
    const outer = nameSegments(scope);
    return outer === null ? null : [...outer, name.text];
}

/**
 * A reference met in the tree, kept until the whole file is read: whether a name is a type depends on what the file
 * declares and imports, anywhere in it.
 * - name: a simple name in a type (object false) or the object of a call or field access (object true);
 * - qualified: a dotted name with a lower-case head; in an expression (object true) the head mustn't be a variable.
 */
type Candidate =
    | { specifier: string }
    | { name: string; object: boolean }
    | { qualified: string; head: string; object: boolean };

/** What the walk finds: every candidate in source order, and the sets that decide which of them are types. */
type FileFacts = {
    candidates: Candidate[];
    importTexts: string[];
    /** The package line's name; null when the file has none (the default package). */
    packageName: string | null;
    singleImported: Set<string>;
    staticMembers: Set<string>;
    declaredTypes: Set<string>;
    typeParameters: Set<string>;
    variables: Set<string>;
};

/**
 * A dotted name's candidate (the plan's rule): an upper-case head is a simple name (`Map.Entry`, `Mode.FAST` → Map, Mode);
 * a lower-case head starts a package, and the qualified name runs to the first segment that starts upper-case
 * (`com.example.lib.Strings.shout` → com.example.lib.Strings). With no upper-case segment it's no type at all.
 */
function chainCandidate(segments: readonly string[], object: boolean): Candidate | null {
    if (segments.length === 0 || segments.some((s) => s === "")) return null;
    if (UPPER_START.test(segments[0])) return { name: segments[0], object };
    const typeAt = segments.findIndex((s) => UPPER_START.test(s));
    return typeAt <= 0 ? null : { qualified: segments.slice(0, typeAt + 1).join("."), head: segments[0], object };
}

/** A field_access made only of identifiers (`a.b.C.D`), as its segments; null when any part is a call, `this`, `super`… */
function pureChain(node: Node): string[] | null {
    const segments: string[] = [];
    let current: Node | null = node;
    while (current !== null && current.type === "field_access"){
        const field = current.childForFieldName("field");
        if (field === null || field.type !== "identifier") return null;
        segments.unshift(field.text);
        current = current.childForFieldName("object");
    }
    if (current === null || current.type !== "identifier") return null;
    segments.unshift(current.text);
    return segments;
}

/**
 * A scoped type's segments (`com.example.Formatter`, `Outer<String>.Inner`), with the nodes inside it that hold further
 * types (a generic part's type arguments, an annotation) for the walk to visit after it.
 */
function scopedTypeSegments(node: Node, later: Node[]): string[] | null {
    const segments: string[] = [];
    for (const child of node.namedChildren){
        if (child.type === "type_identifier") segments.push(child.text);
        else if (child.type === "scoped_type_identifier"){
            const inner = scopedTypeSegments(child, later);
            if (inner === null) return null;
            segments.push(...inner);
        } else if (child.type === "generic_type"){
            for (const part of child.namedChildren){
                if (part.type === "type_identifier") segments.push(part.text);
                else if (part.type === "scoped_type_identifier"){
                    const inner = scopedTypeSegments(part, later);
                    if (inner === null) return null;
                    segments.push(...inner);
                } else later.push(part);
            }
        } else later.push(child);   // an annotation inside the type (java.util.@NonNull List)
    }
    return segments;
}

/** The identifier a node's `name` field holds, as text, or null (a MISSING node's text is ""). */
function nameOf(node: Node): string | null {
    const name = node.childForFieldName("name");
    return name === null || name.text === "" ? null : name.text;
}

/**
 * One walk over the whole tree, in source order (an explicit stack: a long chain of `+` nests deeper than recursion
 * should go). Each node either records what it is and lets the walk go on into its children, or reads its own subtree
 * whole (an import, a scoped type, a chain of identifiers) and stops the walk there.
 */
function walk(root: Node): FileFacts {
    const facts: FileFacts = {
        candidates: [], importTexts: [], packageName: null,
        singleImported: new Set(), staticMembers: new Set(), declaredTypes: new Set(), typeParameters: new Set(), variables: new Set(),
    };
    const addVariable = (node: Node | null): void => {
        if (node !== null && node.type === "identifier" && node.text !== "") facts.variables.add(node.text);
    };

    const stack: Node[] = [root];
    const pushChildren = (node: Node, skip?: (child: Node) => boolean): void => {
        const children = node.children;
        for (let i = children.length - 1; i >= 0; i--){
            const child = children[i];
            if (child.isNamed && !(skip?.(child) ?? false)) stack.push(child);
        }
    };

    while (stack.length > 0){
        const node = stack.pop()!;
        switch (node.type){
            case "line_comment":
            case "block_comment":
            case "module_declaration":   // module-info.java's requires and exports name modules, not types
                break;

            case "package_declaration": {
                const name = node.namedChildren.find((c) => c.type === "identifier" || c.type === "scoped_identifier");
                const segments = name === undefined ? null : nameSegments(name);
                if (segments !== null && segments.every((s) => s !== "")) facts.packageName = segments.join(".");
                pushChildren(node, (c) => c.type !== "annotation" && c.type !== "marker_annotation");   // its annotations only
                break;
            }

            case "import_declaration": {
                const isStatic = node.children.some((c) => c.type === "static");
                const onDemand = node.namedChildren.some((c) => c.type === "asterisk");
                const name = node.namedChildren.find((c) => c.type === "identifier" || c.type === "scoped_identifier");
                const segments = name === undefined ? null : nameSegments(name);
                const specifier = segments === null ? null : importSpecifier(isStatic, segments, onDemand);
                if (specifier === null || segments === null) break;
                facts.candidates.push({ specifier });
                facts.importTexts.push(node.text.replace(/\s+/g, " ").trim());
                if (!onDemand) (isStatic ? facts.staticMembers : facts.singleImported).add(segments[segments.length - 1]);
                break;
            }

            case "type_identifier":
                // `var` is a reserved type name (Java 10), never a class
                if (node.text !== "" && node.text !== "var") facts.candidates.push({ name: node.text, object: false });
                break;

            case "scoped_type_identifier": {
                const later: Node[] = [];
                const segments = scopedTypeSegments(node, later);
                const candidate = segments === null ? null : chainCandidate(segments, false);
                if (candidate !== null) facts.candidates.push(candidate);
                for (let i = later.length - 1; i >= 0; i--) stack.push(later[i]);
                break;
            }

            case "field_access": {
                const segments = pureChain(node);
                if (segments === null){
                    pushChildren(node);
                    break;
                }
                const candidate = chainCandidate(segments, true);
                if (candidate !== null) facts.candidates.push(candidate);
                break;
            }

            case "method_invocation": {
                const object = node.childForFieldName("object");
                if (object !== null && object.type === "identifier") facts.candidates.push({ name: object.text, object: true });
                pushChildren(node);
                break;
            }

            case "method_reference": {
                // C::m — the left side parses as an identifier when it could be a variable too
                const left = node.namedChildren[0];
                if (left !== undefined && left.type === "identifier") facts.candidates.push({ name: left.text, object: true });
                pushChildren(node);
                break;
            }

            case "marker_annotation":
            case "annotation": {
                const name = node.childForFieldName("name");
                if (name !== null && name.type === "identifier" && name.text !== "") facts.candidates.push({ name: name.text, object: false });
                else if (name !== null){
                    const segments = nameSegments(name);
                    const candidate = segments === null ? null : chainCandidate(segments, false);
                    if (candidate !== null) facts.candidates.push(candidate);
                }
                // the name is the only identifier child; the arguments sit in an annotation_argument_list
                pushChildren(node, (c) => c.type === "identifier" || c.type === "scoped_identifier");
                break;
            }

            case "type_parameter": {
                const own = node.namedChildren.find((c) => c.type === "type_identifier");
                if (own !== undefined && own.text !== "") facts.typeParameters.add(own.text);
                pushChildren(node, (c) => c.type === "type_identifier");   // its own name; the bounds sit in a type_bound
                break;
            }

            case "variable_declarator":
            case "formal_parameter":
            case "catch_formal_parameter":
            case "enhanced_for_statement":
            case "resource":
            case "enum_constant":
            case "instanceof_expression":
                addVariable(node.childForFieldName("name"));
                pushChildren(node);
                break;

            case "lambda_expression": {
                const parameters = node.childForFieldName("parameters");
                if (parameters !== null && parameters.type === "identifier") addVariable(parameters);
                else if (parameters !== null && parameters.type === "inferred_parameters") for (const p of parameters.namedChildren) addVariable(p);
                pushChildren(node);
                break;
            }

            case "type_pattern":
                for (const child of node.namedChildren) addVariable(child);
                pushChildren(node);
                break;

            default: {
                const kinds = TYPE_KINDS[node.type];
                if (kinds !== undefined){
                    const name = nameOf(node);
                    if (name !== null) facts.declaredTypes.add(name);
                }
                pushChildren(node);
            }
        }
    }
    return facts;
}

/** The candidates that are references, as specifiers, each once, in source order (the plan's type:C exclusions). */
function specifiersOf(facts: FileFacts): string[] {
    const out = new Set<string>();
    for (const candidate of facts.candidates){
        if ("specifier" in candidate){
            out.add(candidate.specifier);
        } else if ("name" in candidate){
            const { name, object } = candidate;
            if (facts.singleImported.has(name) || facts.declaredTypes.has(name) || facts.typeParameters.has(name)) continue;
            // an object is a type only when it starts upper-case and the file doesn't hold a variable by that name
            if (object && (!UPPER_START.test(name) || facts.variables.has(name) || facts.staticMembers.has(name))) continue;
            out.add(`type:${name}`);
        } else{
            if (candidate.object && (facts.variables.has(candidate.head) || facts.staticMembers.has(candidate.head))) continue;
            out.add(`qualified:${candidate.qualified}`);
        }
    }
    return [...out];
}

/** The modifier keywords a declaration carries (public, static, …): its `modifiers` child's keyword tokens. */
function modifiersOf(node: Node): Set<string> {
    const set = new Set<string>();
    const modifiers = node.namedChildren.find((c) => c.type === "modifiers");
    if (modifiers !== undefined) for (const c of modifiers.children) if (!c.isNamed) set.add(c.type);
    return set;
}

/** A type declaration's members, in source order: an enum's constants first, then the declarations after them. */
function membersOf(declaration: Node): Node[] {
    const body = declaration.childForFieldName("body");
    if (body === null) return [];
    if (body.type !== "enum_body") return body.namedChildren;
    return body.namedChildren.flatMap((c) => (c.type === "enum_body_declarations" ? c.namedChildren : [c]));
}

const STRING_TYPES = new Set(["String", "java.lang.String"]);

/** `public static void main(String[] args)`, `(String... args)` or `(String args[])`; in an interface, `public` is implied. */
function isMainMethod(method: Node, inInterface: boolean): boolean {
    if (method.type !== "method_declaration" || nameOf(method) !== "main") return false;
    const modifiers = modifiersOf(method);
    if (!modifiers.has("static") || !(modifiers.has("public") || inInterface)) return false;
    if (method.childForFieldName("type")?.type !== "void_type") return false;
    const parameters = method.childForFieldName("parameters")?.namedChildren.filter((c) => c.type !== "line_comment" && c.type !== "block_comment") ?? [];
    if (parameters.length !== 1) return false;
    const parameter = parameters[0];
    if (parameter.type === "spread_parameter"){
        const type = parameter.namedChildren.find((c) => c.type === "type_identifier" || c.type === "scoped_type_identifier");
        return type !== undefined && STRING_TYPES.has(type.text);
    }
    if (parameter.type !== "formal_parameter") return false;
    const type = parameter.childForFieldName("type");
    if (type === null) return false;
    if (type.type === "array_type"){
        const element = type.childForFieldName("element");
        return element !== null && STRING_TYPES.has(element.text) && type.childForFieldName("dimensions")?.text.replace(/\s/g, "") === "[]";
    }
    // String args[]: the brackets sit on the name
    return STRING_TYPES.has(type.text) && parameter.childForFieldName("dimensions")?.text.replace(/\s/g, "") === "[]";
}

/** A comment attached above a declaration: a comment that doesn't share its first line with code before it. */
function isAttachedComment(previous: Node): boolean {
    if (previous.type !== "line_comment" && previous.type !== "block_comment") return false;
    const before = previous.previousSibling;
    return before === null || before.type === "line_comment" || before.type === "block_comment" || endLineOf(before) < startLineOf(previous);
}

type TopLevel = { node: Node; name: string; kinds: { symbol: SymbolKind; chunk: ChunkKind }; exported: boolean };

function topLevelTypes(root: Node): TopLevel[] {
    const out: TopLevel[] = [];
    for (const node of root.namedChildren){
        const kinds = TYPE_KINDS[node.type];
        const name = kinds === undefined ? null : nameOf(node);
        if (kinds !== undefined && name !== null) out.push({ node, name, kinds, exported: modifiersOf(node).has("public") });
    }
    return out;
}

function declaresOf(packageName: string | null, types: readonly TopLevel[]): string[] {
    const pkg = packageName ?? "";
    const qualify = (name: string): string => (pkg === "" ? name : `${pkg}.${name}`);
    const declares = new Set<string>([`package:${pkg}`]);
    for (const t of types){
        declares.add(`type:${qualify(t.name)}`);
        const inInterface = t.kinds.symbol === "interface";
        if (membersOf(t.node).some((m) => isMainMethod(m, inInterface))) declares.add(`main:${qualify(t.name)}`);
    }
    return [...declares].sort();
}

/**
 * The top-level types and one level of their members (the plan's symbols). Exported: a top-level type with `public`; a
 * member of an exported type with `public`, or, in an interface or annotation type, any member not `private`, and an
 * enum's constants (both implicitly public).
 */
function symbolsOf(types: readonly TopLevel[]): SymbolRow[] {
    const symbols: SymbolRow[] = [];
    const add = (node: Node, name: string, kind: SymbolKind, exported: boolean, parent: string | null): void => {
        symbols.push({
            name, qualifiedName: parent === null ? name : `${parent}.${name}`, kind,
            // the node's own range: its annotations sit inside it (modifiers), its comments outside
            startLine: startLineOf(node), endLine: endLineOf(node), exported, parentQualifiedName: parent,
        });
    };

    for (const t of types){
        add(t.node, t.name, t.kinds.symbol, t.exported, null);
        const implicitPublic = t.kinds.symbol === "interface";
        for (const member of membersOf(t.node)){
            const modifiers = modifiersOf(member);
            const isPublic = modifiers.has("public") || ((implicitPublic || member.type === "enum_constant") && !modifiers.has("private"));
            const exported = t.exported && isPublic;
            const nested = TYPE_KINDS[member.type];
            const name = nameOf(member);
            if (nested !== undefined){
                if (name !== null) add(member, name, nested.symbol, exported, t.name);
            } else if (member.type === "method_declaration" || member.type === "annotation_type_element_declaration"){
                if (name !== null) add(member, name, "method", exported, t.name);
            } else if (member.type === "constructor_declaration" || member.type === "compact_constructor_declaration"){
                if (name !== null) add(member, name, "constructor", exported, t.name);
            } else if (member.type === "enum_constant"){
                if (name !== null) add(member, name, "property", exported, t.name);
            } else if (member.type === "field_declaration" || member.type === "constant_declaration"){
                // `int a, b;` is two properties, each with the declaration's lines
                for (const declarator of member.childrenForFieldName("declarator")){
                    const own = nameOf(declarator);
                    if (own !== null) add(member, own, "property", exported, t.name);
                }
            }
        }
    }
    return symbols;
}

function chunksOf(path: string, text: string, types: readonly TopLevel[], importTexts: readonly string[]) {
    const declarations: Declaration[] = types.map((t) => ({
        kind: t.kinds.chunk, name: t.name, ...leadingSpan(t.node, isAttachedComment), exported: t.exported,
    }));
    return assembleChunks(path, text, declarations, {
        imports: importTexts,
        exports: types.filter((t) => t.exported).map((t) => `${t.name} (${t.kinds.symbol})`),
    });
}

/** An import statement at the start of a line, or after another one on it (the scan reading). */
const IMPORT_STATEMENT = /^\s*import\s+(static\s+)?([\p{L}\p{N}_$]+(?:\s*\.\s*[\p{L}\p{N}_$]+)*)(\s*\.\s*\*)?\s*;/u;

/**
 * The scan reading (a file over the parse cap): its `import …;` lines, read without a tree. Its known difference from the
 * full reading: no type: or qualified: specifiers, which need the tree. The package line gives nothing: declares need
 * the tree too.
 */
export function scanImports(text: string): string[] {
    const out = new Set<string>();
    for (const raw of withoutBom(text).split("\n")){
        let rest = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        for (let match = IMPORT_STATEMENT.exec(rest); match !== null; match = IMPORT_STATEMENT.exec(rest)){
            const segments = match[2].split(".").map((s) => s.trim());
            const specifier = importSpecifier(match[1] !== undefined, segments, match[3] !== undefined);
            if (specifier !== null) out.add(specifier);
            rest = rest.slice(match[0].length);
        }
    }
    return [...out];
}

/** One Java file's products (LanguageAdapter.parse): "full" everything, "parse" imports and declares, "scan" imports. */
export function parseJava(path: string, text: string, reading: Reading): ParsedFile {
    const lineCount = countLines(withoutBom(text));
    if (reading === "scan"){
        return { chunks: [], symbols: [], imports: scanImports(text), declares: [], calls: emptyCallFacts(), lineCount };
    }
    return parseTree("java", text, (root) => {
        const facts = walk(root);
        const types = topLevelTypes(root);
        const full = reading === "full";
        return {
            chunks: full ? chunksOf(path, text, types, facts.importTexts) : [],
            symbols: full ? symbolsOf(types) : [],
            imports: specifiersOf(facts),
            declares: declaresOf(facts.packageName, types),
            calls: emptyCallFacts(),
            lineCount,
        };
    });
}
