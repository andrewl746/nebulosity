import ts from "typescript";
import type { BindingFact, CallFacts, CallRule, TypeDeclFact, TypedCallFact } from "../../db/schema";

/**
 * Calls through declared types (ADR-059): the call facts of one parsed file. Pure syntax, one file at a time: a receiver's
 * type is read from what the code declares (a parameter, a local, a field, a provider's id, new C(), a cast), never
 * inferred; resolving a type name to the file that declares it happens later, in the engine, through the stored imports.
 */

export function emptyCallFacts(): CallFacts {
    return { types: [], bindings: [], calls: [] };
}

/** Wrappers whose first type argument is the type a call goes to: Partial<IFoo> is still an IFoo. */
const WRAPPERS = new Set(["Pick", "Partial", "Readonly", "Required", "NonNullable", "Omit", "Mutable", "DeepPartial", "Mocked", "MockProxy"]);
/** accessor.get(IFoo), container.getOptional(Foo): a service asked for by its id. */
const PROVIDER_METHODS = new Set(["get", "getOptional"]);
/** AFFiNE's hooks; useServices({ Foo }) is read apart. */
const HOOKS = new Set(["useService", "useServiceOptional"]);
/** store.add(new C()), this._register(new C()), disposables.add(new C()): the value is the new C. */
const PASS_THROUGH = new Set(["add", "_register"]);
/** How far a local's initializer is followed (const a = b; const b = this.f), and a type parameter's constraint. */
const MAX_DEPTH = 4;

type Receiver = { receiver: TypedCallFact["receiver"]; ref: string | null; inClass: string | null; how: CallRule };
type Anchored = { pos: number; fact: TypedCallFact };

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function collectCallFacts(sourceFile: ts.SourceFile): CallFacts {
    const lineOf = (node: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const types = collectTypes(sourceFile, lineOf);
    const found: Anchored[] = [];
    const site = (node: ts.Node, ref: string, how: CallRule): void => {
        found.push({ pos: node.getStart(sourceFile), fact: { line: lineOf(node), member: null, receiver: "type", ref, inClass: enclosingClassName(node), how } });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isConstructorDeclaration(node)){
            // a constructor parameter typed T receives a T (R-S), decorated or not; untyped, an @inject(T) names it
            for (const p of node.parameters){
                const ref = p.type ? typeRefOf(p.type, p) : injectArgument(p);
                const at = p.type ?? injectNode(p);
                if (ref !== null && at !== null) site(at, ref, "ctor-param");
            }
        } else if (ts.isPropertyDeclaration(node) && injectNode(node) !== null){
            const ref = node.type ? typeRefOf(node.type, node) : injectArgument(node);
            if (ref !== null) site(node.type ?? injectNode(node)!, ref, "inject-field");
        } else if (ts.isCallExpression(node)){
            const provided = providedRef(node);
            if (provided !== null) site(node.arguments[0], provided, "provider");
            for (const [value, ref] of servicesKeysOf(node)) site(value, ref, "provider");
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && (ts.isIdentifier(callee.name) || ts.isPrivateIdentifier(callee.name))){
                const r = receiverOf(callee.expression, 0);
                if (r !== null){
                    const inClass = r.receiver === "type" ? enclosingClassName(node) : r.inClass;
                    found.push({ pos: callee.name.getStart(sourceFile), fact: { line: lineOf(callee.name), member: callee.name.text, ...r, inClass } });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    // source order of each fact's anchor (a call's member name, a site's TypeRef node); sort is stable
    const calls = found.sort((a, b) => a.pos - b.pos).map((a) => a.fact);
    return { types, bindings: collectBindings(sourceFile, types, calls), calls };
}

// ---- declarations

function collectTypes(sourceFile: ts.SourceFile, lineOf: (node: ts.Node) => number): TypeDeclFact[] {
    const out: TypeDeclFact[] = [];
    const interfaces = new Map<string, TypeDeclFact>();   // a second `interface X` in the file merges into the first
    const visit = (node: ts.Node, topLevel: boolean): void => {
        if (ts.isInterfaceDeclaration(node) && topLevel){
            let fact = interfaces.get(node.name.text);
            if (!fact){
                fact = { name: node.name.text, kind: "interface", line: lineOf(node.name), exported: false, nested: false,
                    extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: [], fields: {} };
                interfaces.set(node.name.text, fact);
                out.push(fact);
            }
            fact.exported ||= hasModifier(node, ts.SyntaxKind.ExportKeyword);
            for (const clause of node.heritageClauses ?? []) for (const t of clause.types){
                const ref = refOfExpression(t.expression);
                if (ref !== null) fact.extendsRefs.push(ref);
            }
            for (const m of node.members){
                const name = memberName(m.name);
                if (name !== null) fact.members.push(name);
            }
        } else if (ts.isClassLike(node) && (topLevel ? ts.isClassDeclaration(node) : node.heritageClauses !== undefined)){
            out.push(classFact(node, topLevel, lineOf));
        }
        // the file's statements are top level; anything inside one isn't (R-O)
        ts.forEachChild(node, (child) => visit(child, false));
    };
    for (const statement of sourceFile.statements) visit(statement, true);
    for (const fact of out) fact.members = [...new Set(fact.members)].sort(compare);
    return out;
}

function classFact(node: ts.ClassLikeDeclaration, topLevel: boolean, lineOf: (node: ts.Node) => number): TypeDeclFact {
    const fact: TypeDeclFact = {
        name: node.name?.text ?? null, kind: "class", line: lineOf(node.name ?? node),
        exported: topLevel && hasModifier(node, ts.SyntaxKind.ExportKeyword), nested: !topLevel,
        extendsRefs: [], implementsRefs: [], testDoubleOf: null, members: [], fields: {},
    };
    for (const clause of node.heritageClauses ?? []){
        for (const t of clause.types){
            const base = t.expression;
            if (clause.token === ts.SyntaxKind.ExtendsKeyword && ts.isCallExpression(base)){
                // class X extends mock<IFoo>() { … }: a test double of IFoo
                if (ts.isIdentifier(base.expression) && base.expression.text === "mock" && base.typeArguments?.length === 1){
                    fact.testDoubleOf = typeRefOf(base.typeArguments[0], node);
                }
                continue;
            }
            const ref = refOfExpression(base);
            if (ref !== null) (clause.token === ts.SyntaxKind.ExtendsKeyword ? fact.extendsRefs : fact.implementsRefs).push(ref);
        }
    }
    for (const member of node.members){
        if (ts.isConstructorDeclaration(member)){
            for (const p of member.parameters){
                if (!ts.isIdentifier(p.name) || !isParameterProperty(p)) continue;
                fact.members.push(p.name.text);
                const ref = p.type ? typeRefOf(p.type, p) : null;
                if (ref !== null) fact.fields[p.name.text] = ref;
            }
            continue;
        }
        const name = memberName(member.name);
        if (name === null) continue;
        fact.members.push(name);
        const ref = ts.isPropertyDeclaration(member) ? (member.type ? typeRefOf(member.type, member) : member.initializer ? valueTypeRef(member.initializer) : null)
            : ts.isGetAccessorDeclaration(member) && member.type ? typeRefOf(member.type, member)
            : null;
        if (ref !== null) fact.fields[name] = ref;
    }
    return fact;
}

// ---- receivers

function receiverOf(expression: ts.Expression, depth: number): Receiver | null {
    const e = unwrap(expression);
    if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)){
        const ref = typeRefOf(e.type, e);
        return ref === null ? null : { receiver: "type", ref, inClass: null, how: "cast" };
    }
    if (e.kind === ts.SyntaxKind.ThisKeyword){
        const inClass = thisClass(e);
        return inClass === null ? null : { receiver: "this", ref: null, inClass, how: "this" };
    }
    if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword){
        const inClass = thisClass(e);
        const name = memberName(e.name);
        return inClass === null || name === null ? null : { receiver: "field", ref: name, inClass, how: "field" };
    }
    const value = valueTypeRef(e);
    if (value !== null) return { receiver: "type", ref: value, inClass: null, how: ts.isCallExpression(e) && providedRef(e) !== null ? "provider" : "new" };
    if (ts.isIdentifier(e)) return identifierReceiver(e, depth);
    return null;
}

function identifierReceiver(id: ts.Identifier, depth: number): Receiver | null {
    const declaration = findDeclaration(id);
    if (declaration === null) return null;
    if (ts.isParameter(declaration) || (ts.isVariableDeclaration(declaration) && declaration.type)){
        if (!declaration.type) return null;
        const ref = typeRefOf(declaration.type, declaration);
        if (ref === null) return null;
        const how: CallRule = isTypeParameterRef(declaration.type, declaration) ? "constraint" : ts.isParameter(declaration) ? "param" : "local";
        return { receiver: "type", ref, inClass: null, how };
    }
    if (ts.isVariableDeclaration(declaration)){
        if (!declaration.initializer || depth >= MAX_DEPTH) return null;
        const inner = receiverOf(declaration.initializer, depth + 1);
        // const files = this.fileService: an alias of a field
        return inner !== null && inner.receiver === "field" ? { ...inner, how: "alias" } : inner;
    }
    if (ts.isBindingElement(declaration)) return bindingReceiver(declaration);
    return null;
}

/** ({ files }: { files: IFoo }) => …, or const { fooService } = useServices({ FooService }): a destructured name a rule can type. */
function bindingReceiver(element: ts.BindingElement): Receiver | null {
    const key = element.propertyName ? memberName(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : null;
    if (key === null || !ts.isObjectBindingPattern(element.parent)) return null;
    const holder = element.parent.parent;
    if ((ts.isParameter(holder) || ts.isVariableDeclaration(holder)) && holder.type && ts.isTypeLiteralNode(holder.type)){
        for (const m of holder.type.members){
            if (ts.isPropertySignature(m) && memberName(m.name) === key && m.type){
                const ref = typeRefOf(m.type, m);
                return ref === null ? null : { receiver: "type", ref, inClass: null, how: "destructure" };
            }
        }
        return null;
    }
    if (ts.isVariableDeclaration(holder) && holder.initializer){
        const init = unwrap(holder.initializer);
        if (ts.isCallExpression(init)){
            for (const [value, ref] of servicesKeysOf(init)){
                const name = ts.isShorthandPropertyAssignment(value.parent) || ts.isPropertyAssignment(value.parent) ? memberName(value.parent.name) : null;
                if (name !== null && uncapitalize(name) === key) return { receiver: "type", ref, inClass: null, how: "provider" };
            }
        }
    }
    return null;
}

/** The type a value is sure to have, read from its syntax: new C(), x.add(new C()), this._register(new C()), a provider's id. */
function valueTypeRef(expression: ts.Expression): string | null {
    const e = unwrap(expression);
    if (ts.isNewExpression(e)) return refOfExpression(e.expression);
    if (!ts.isCallExpression(e)) return null;
    const provided = providedRef(e);
    if (provided !== null) return provided;
    const callee = e.expression;
    const first = e.arguments[0];
    if (ts.isPropertyAccessExpression(callee) && PASS_THROUGH.has(callee.name.text) && first !== undefined){
        const inner = unwrap(first);
        if (ts.isNewExpression(inner)) return refOfExpression(inner.expression);
    }
    return null;
}

/** accessor.get(IFoo), x.getOptional(IFoo), useService(Foo), useServiceOptional(Foo): the id asked for, when it is a module-level name. */
function providedRef(call: ts.CallExpression): string | null {
    const callee = call.expression;
    const asks = (ts.isPropertyAccessExpression(callee) && PROVIDER_METHODS.has(callee.name.text)) || (ts.isIdentifier(callee) && HOOKS.has(callee.text));
    const first = call.arguments[0];
    return asks && first !== undefined ? moduleLevelRef(first) : null;
}

/** useServices({ FooService, bar: BarService }): each key's value node and its ref. */
function servicesKeysOf(call: ts.CallExpression): [ts.Expression, string][] {
    const arg = call.arguments[0];
    if (!ts.isIdentifier(call.expression) || call.expression.text !== "useServices" || arg === undefined || !ts.isObjectLiteralExpression(arg)) return [];
    const out: [ts.Expression, string][] = [];
    for (const p of arg.properties){
        const value = ts.isShorthandPropertyAssignment(p) ? p.name : ts.isPropertyAssignment(p) ? p.initializer : null;
        const ref = value === null ? null : moduleLevelRef(value);
        if (value !== null && ref !== null) out.push([value, ref]);
    }
    return out;
}

/** @inject(X) on a field or a parameter: the decorator's call. */
function injectNode(node: ts.HasDecorators): ts.Expression | null {
    for (const d of ts.getDecorators(node) ?? []){
        const e = d.expression;
        if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "inject" && e.arguments[0] !== undefined) return e.arguments[0];
    }
    return null;
}

function injectArgument(node: ts.HasDecorators): string | null {
    const arg = injectNode(node);
    return arg === null ? null : moduleLevelRef(arg);
}

// ---- type references

/** A type annotation as a TypeRef, through parentheses, unions, intersections and wrappers; a type parameter reads as its constraint. */
function typeRefOf(type: ts.TypeNode, scope: ts.Node, depth = 0): string | null {
    if (depth > MAX_DEPTH) return null;
    if (ts.isParenthesizedTypeNode(type)) return typeRefOf(type.type, scope, depth + 1);
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)){
        for (const part of type.types){
            const ref = typeRefOf(part, scope, depth + 1);
            if (ref !== null) return ref;
        }
        return null;
    }
    if (!ts.isTypeReferenceNode(type)) return null;
    const name = type.typeName;
    if (ts.isQualifiedName(name)) return ts.isIdentifier(name.left) ? `${name.left.text}.${name.right.text}` : null;
    if (WRAPPERS.has(name.text) && type.typeArguments?.length) return typeRefOf(type.typeArguments[0], scope, depth + 1);
    const parameter = typeParameterNamed(name.text, scope);
    if (parameter === undefined) return name.text;
    return parameter?.constraint ? typeRefOf(parameter.constraint, parameter, depth + 1) : null;
}

function isTypeParameterRef(type: ts.TypeNode, scope: ts.Node): boolean {
    return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && typeParameterNamed(type.typeName.text, scope) !== undefined;
}

/** The type parameter a name means where it is written, or undefined when none in scope has that name. */
function typeParameterNamed(name: string, scope: ts.Node): ts.TypeParameterDeclaration | undefined {
    for (let n: ts.Node | undefined = scope; n !== undefined; n = n.parent){
        const params = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
        const found = params?.find((p) => p.name.text === name);
        if (found) return found;
    }
    return undefined;
}

/** "IFoo" or "ns.IFoo" for an identifier or a namespace's member; anything else null. */
function refOfExpression(e: ts.Expression): string | null {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ts.isIdentifier(e.name)) return `${e.expression.text}.${e.name.text}`;
    return null;
}

/** A ref whose root name is an import or a top-level declaration (not a parameter or a local): map.get(key) isn't a provider. */
function moduleLevelRef(e: ts.Expression): string | null {
    const ref = refOfExpression(unwrap(e));
    if (ref === null) return null;
    const inner = unwrap(e);
    const root = ts.isIdentifier(inner) ? inner : (inner as ts.PropertyAccessExpression).expression as ts.Identifier;
    const declaration = findDeclaration(root);
    if (declaration === null) return ref;   // an import, or a global
    return ts.isVariableDeclaration(declaration) && ts.isVariableStatement(declaration.parent.parent) && ts.isSourceFile(declaration.parent.parent.parent) ? ref : null;
}

// ---- scopes

/** The nearest declaration of a name in the syntactic scopes around it: a parameter, a variable, a destructured binding. */
function findDeclaration(id: ts.Identifier): ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement | null {
    const name = id.text;
    const inPattern = (binding: ts.BindingName): ts.BindingElement | null => {
        if (ts.isIdentifier(binding)) return null;
        for (const el of binding.elements){
            if (ts.isOmittedExpression(el)) continue;
            if (ts.isIdentifier(el.name) && el.name.text === name) return el;
            const deeper = inPattern(el.name);
            if (deeper) return deeper;
        }
        return null;
    };
    const inDeclarations = (list: ts.VariableDeclarationList): ts.VariableDeclaration | ts.BindingElement | null => {
        for (const d of list.declarations){
            if (ts.isIdentifier(d.name)){
                if (d.name.text === name) return d;
            } else {
                const el = inPattern(d.name);
                if (el) return el;
            }
        }
        return null;
    };
    for (let node: ts.Node | undefined = id.parent; node !== undefined; node = node.parent){
        if (ts.isFunctionLike(node)){
            for (const p of node.parameters){
                if (ts.isIdentifier(p.name) ? p.name.text === name : inPattern(p.name) !== null) return ts.isIdentifier(p.name) ? p : inPattern(p.name);
            }
        }
        if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)){
            const found = declaredIn(node).get(name);
            if (found) return found;
        }
        if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)){
            const found = inDeclarations(node.initializer);
            if (found) return found;
        }
        if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name) && node.variableDeclaration.name.text === name){
            return node.variableDeclaration;
        }
    }
    return null;
}

/**
 * Each scope's variable names → declaration, built once per scope node and first declaration wins (what a linear scan of its
 * statements finds first). Without it every `x.m()` re-scans all the statements of its scope: a flat generated file with
 * tens of thousands of them would take minutes (ADR-053's aim: a giant generated file can't stall a run).
 */
const declaredNames = new WeakMap<ts.Node, Map<string, ts.VariableDeclaration | ts.BindingElement>>();

function declaredIn(scope: ts.Block | ts.SourceFile | ts.ModuleBlock | ts.CaseClause | ts.DefaultClause): Map<string, ts.VariableDeclaration | ts.BindingElement> {
    let names = declaredNames.get(scope);
    if (names) return names;
    const map = new Map<string, ts.VariableDeclaration | ts.BindingElement>();
    const add = (name: string, declaration: ts.VariableDeclaration | ts.BindingElement): void => {
        if (!map.has(name)) map.set(name, declaration);
    };
    const addPattern = (binding: ts.BindingName): void => {
        if (ts.isIdentifier(binding)) return;
        for (const el of binding.elements){
            if (ts.isOmittedExpression(el)) continue;
            if (ts.isIdentifier(el.name)) add(el.name.text, el);
            else addPattern(el.name);
        }
    };
    for (const statement of scope.statements){
        if (!ts.isVariableStatement(statement)) continue;
        for (const d of statement.declarationList.declarations){
            if (ts.isIdentifier(d.name)) add(d.name.text, d);
            else addPattern(d.name);
        }
    }
    names = map;
    declaredNames.set(scope, names);
    return names;
}

/** The top-level class a `this` belongs to: not past a function (it has its own this), nor an object literal's method. */
function thisClass(node: ts.Node): string | null {
    for (let n = node.parent; n !== undefined; n = n.parent){
        if (ts.isClassLike(n)) return ts.isClassDeclaration(n) && n.name !== undefined && ts.isSourceFile(n.parent) ? n.name.text : null;
        if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) return null;
        if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && ts.isObjectLiteralExpression(n.parent)) return null;
    }
    return null;
}

/** The top-level class a node sits in, whatever functions lie between, or null. */
function enclosingClassName(node: ts.Node): string | null {
    for (let n = node.parent; n !== undefined; n = n.parent){
        if (ts.isClassLike(n)) return ts.isClassDeclaration(n) && n.name !== undefined && ts.isSourceFile(n.parent) ? n.name.text : null;
    }
    return null;
}

// ---- bindings

function collectBindings(sourceFile: ts.SourceFile, types: readonly TypeDeclFact[], calls: readonly TypedCallFact[]): BindingFact[] {
    const all: BindingFact[] = [];
    for (const s of sourceFile.statements){
        if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.importClause){
            const specifier = s.moduleSpecifier.text;
            const clause = s.importClause;
            if (clause.name) all.push({ kind: "import", local: clause.name.text, imported: "default", specifier });
            const named = clause.namedBindings;
            if (named && ts.isNamespaceImport(named)) all.push({ kind: "import", local: named.name.text, imported: "*", specifier });
            else if (named) for (const el of named.elements) all.push({ kind: "import", local: el.name.text, imported: (el.propertyName ?? el.name).text, specifier });
        } else if (ts.isExportDeclaration(s)){
            const specifier = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : null;
            const clause = s.exportClause;
            if (specifier !== null && clause === undefined) all.push({ kind: "reexport", local: "*", imported: "*", specifier });
            else if (specifier !== null && clause !== undefined && ts.isNamespaceExport(clause)) all.push({ kind: "reexport", local: clause.name.text, imported: "*", specifier });
            else if (clause !== undefined && ts.isNamedExports(clause)){
                for (const el of clause.elements){
                    const exported = el.name.text;
                    const local = (el.propertyName ?? el.name).text;
                    all.push(specifier === null ? { kind: "export", local: exported, imported: local, specifier: null } : { kind: "reexport", local: exported, imported: local, specifier });
                }
            }
        } else if (ts.isExportAssignment(s) && !s.isExportEquals && ts.isIdentifier(s.expression)){
            all.push({ kind: "export", local: "default", imported: s.expression.text, specifier: null });
        } else if ((ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name && hasModifier(s, ts.SyntaxKind.ExportKeyword) && hasModifier(s, ts.SyntaxKind.DefaultKeyword)){
            all.push({ kind: "export", local: "default", imported: s.name.text, specifier: null });
        }
    }
    // the imports a fact names (a TypeRef's first segment, a local export's name); every re-export and export
    const named = new Set<string>();
    const note = (ref: string | null): void => {
        if (ref !== null) named.add(ref.split(".")[0]);
    };
    for (const t of types){
        t.extendsRefs.forEach(note);
        t.implementsRefs.forEach(note);
        note(t.testDoubleOf);
        Object.values(t.fields).forEach(note);
    }
    for (const c of calls) if (c.receiver === "type") note(c.ref);
    for (const b of all) if (b.kind === "export") named.add(b.imported);
    return all.filter((b) => b.kind !== "import" || named.has(b.local));
}

// ---- small helpers

function unwrap(e: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    return e;
}

function memberName(name: ts.PropertyName | ts.MemberName | undefined): string | null {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return null;
}

function isParameterProperty(p: ts.ParameterDeclaration): boolean {
    const kinds = [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword, ts.SyntaxKind.OverrideKeyword];
    return (ts.getModifiers(p) ?? []).some((m) => kinds.includes(m.kind));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((m) => m.kind === kind);
}

const uncapitalize = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
