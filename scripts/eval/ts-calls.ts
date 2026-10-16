/**
 * The call truth (ADR-060, R2): TypeScript's own type checker over a repo's program, never Nebulosity's index. VS Code's
 * program is src/tsconfig.json's (R-R); a repo without node_modules (AFFiNE, Theia, the fixture) gets every .ts and .tsx
 * file it tracks, with module resolution by resolve-truth.ts (workspace packages, exports, compiled → source) and npm
 * packages left unresolved. The rules are D2's sentences; a type is the same type when its exported symbol is. Imports
 * nothing from lib/.
 */
import path from "path";
import ts from "typescript";
import { createTruthResolver } from "./resolve-truth";
import { listFiles, resolveSpecifier } from "./scan";

export type CallTruthKind = "callers" | "breaks" | "injects";
export type CallTarget = { type: string; file: string; member?: string; within?: string };
export type CallTruth = { files: string[]; sites: { file: string; line: number; why: string }[] };

const TS_FILE = /\.(ts|tsx|mts|cts)$/;
const forward = (p: string): string => p.replace(/\\/g, "/");
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function programFor(root: string, options: { project?: string } = {}): { program: ts.Program; files: string[]; ms: number; peakMb: number } {
    const started = performance.now();
    let program: ts.Program;
    if (options.project !== undefined){
        const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, options.project), {}, {
            ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
        });
        if (!parsed) throw new Error(`couldn't read ${options.project}`);
        program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
    } else {
        const files = listFiles(root).filter((f) => TS_FILE.test(f));
        const known = new Set(files);
        const resolveBare = createTruthResolver(root, files);
        const compilerOptions: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit.Preserve, experimentalDecorators: true, strict: true, noEmit: true, skipLibCheck: true, types: [],
        };
        const host = ts.createCompilerHost(compilerOptions);
        host.resolveModuleNameLiterals = (literals, containingFile) => literals.map((literal) => {
            const from = forward(path.relative(root, containingFile));
            const found = resolveSpecifier(from, literal.text, known, resolveBare);
            if (found === null || !TS_FILE.test(found)) return { resolvedModule: undefined };
            const extension = found.endsWith(".d.ts") ? ts.Extension.Dts : found.endsWith(".tsx") ? ts.Extension.Tsx : found.endsWith(".mts") ? ts.Extension.Mts : found.endsWith(".cts") ? ts.Extension.Cts : ts.Extension.Ts;
            return { resolvedModule: { resolvedFileName: path.join(root, found), extension, isExternalLibraryImport: false } };
        });
        program = ts.createProgram({ rootNames: files.map((f) => path.join(root, f)), options: compilerOptions, host });
    }
    const ours = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && !path.relative(root, sf.fileName).startsWith(".."));
    return { program, files: ours.map((sf) => forward(path.relative(root, sf.fileName))).sort(compare), ms: performance.now() - started, peakMb: Math.round(process.resourceUsage().maxRSS / 1024) };
}

export function callTruth(program: ts.Program, root: string, kind: CallTruthKind, target: CallTarget): CallTruth {
    const checker = program.getTypeChecker();
    const rel = (f: string): string => forward(path.relative(root, f));
    const ours = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && !rel(sf.fileName).startsWith(".."));
    const canonical = (s: ts.Symbol | undefined): ts.Symbol | undefined => {
        if (!s) return undefined;
        const unaliased = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
        return checker.getExportSymbolOfSymbol(unaliased);
    };
    const home = ours.find((sf) => rel(sf.fileName) === target.file);
    const declaration = home?.statements.find((s): s is ts.ClassDeclaration | ts.InterfaceDeclaration =>
        (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name?.text === target.type);
    if (!declaration?.name) throw new Error(`${target.file} declares no class or interface named ${target.type}`);
    const T = canonical(checker.getSymbolAtLocation(declaration.name))!;

    // T itself, or a class or interface whose heritage reaches it: extends, implements, or a base whose instance type is T (a test double)
    const memo = new Map<ts.Symbol, boolean>();
    const related = (s: ts.Symbol | undefined, depth = 0): boolean => {
        const c = canonical(s);
        if (!c || depth > 16) return false;
        if (c === T) return true;
        if (memo.has(c)) return memo.get(c)!;
        memo.set(c, false);
        let found = false;
        for (const d of c.declarations ?? []){
            if (!ts.isClassLike(d) && !ts.isInterfaceDeclaration(d)) continue;
            for (const clause of d.heritageClauses ?? []) for (const t of clause.types){
                const base = ts.isCallExpression(t.expression)
                    ? checker.getTypeAtLocation(t.expression).getConstructSignatures()[0]?.getReturnType().getSymbol()
                    : checker.getSymbolAtLocation(t.expression);
                if (related(base, depth + 1)) found = true;
            }
        }
        memo.set(c, found);
        return found;
    };
    const ownerOf = (d: ts.Declaration): ts.Symbol | undefined => {
        const p = d.parent;
        if (ts.isClassLike(p)) return p.name ? checker.getSymbolAtLocation(p.name) : checker.getSymbolAtLocation(p) ?? (p as unknown as { symbol?: ts.Symbol }).symbol;
        if (ts.isInterfaceDeclaration(p)) return checker.getSymbolAtLocation(p.name);
        return undefined;
    };
    const inside = (file: string): boolean => target.within === undefined || file.startsWith(`${target.within}/`);
    const sites: CallTruth["sites"] = [];
    const add = (sf: ts.SourceFile, node: ts.Node, why: string): void => {
        const file = rel(sf.fileName);
        if (inside(file)) sites.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, why });
    };
    const typeIsT = (node: ts.TypeNode): boolean => {
        const t = checker.getTypeFromTypeNode(node);
        return (t.isUnion() ? t.types : [t]).some((p) => canonical(p.getSymbol() ?? p.aliasSymbol) === T);
    };

    for (const sf of ours){
        const visit = (n: ts.Node): void => {
            if ((kind === "callers" || kind === "breaks") && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === target.member){
                const symbol = checker.getSymbolAtLocation(n.expression.name);
                if ((symbol?.declarations ?? []).some((d) => related(ownerOf(d)))) add(sf, n.expression.name, "call");
            }
            if (kind === "breaks" && (ts.isClassLike(n) || ts.isInterfaceDeclaration(n))){
                const own = n.name ? checker.getSymbolAtLocation(n.name) : (n as unknown as { symbol?: ts.Symbol }).symbol;
                const declares = (n.members as ts.NodeArray<ts.ClassElement | ts.TypeElement>).some((m) => m.name !== undefined && ts.isIdentifier(m.name) && m.name.text === target.member);
                if (declares && related(own)) add(sf, n.name ?? n, "declares");
            }
            if (kind === "injects"){
                if (ts.isParameter(n) && ts.isConstructorDeclaration(n.parent) && n.type && typeIsT(n.type)) add(sf, n.type, "constructor");
                if (ts.isPropertyDeclaration(n) && (ts.getDecorators(n) ?? []).some((d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)
                    && d.expression.expression.text === "inject" && d.expression.arguments[0] !== undefined && canonical(checker.getSymbolAtLocation(d.expression.arguments[0])) === T)) add(sf, n.type ?? n, "@inject field");
                if (ts.isCallExpression(n)){
                    const callee = n.expression;
                    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
                    const provider = (ts.isPropertyAccessExpression(callee) && (name === "get" || name === "getOptional")) || (ts.isIdentifier(callee) && (name === "useService" || name === "useServiceOptional"));
                    if (provider && n.arguments[0] !== undefined && canonical(checker.getSymbolAtLocation(n.arguments[0])) === T) add(sf, n.arguments[0], "provider");
                    if (name === "useServices" && n.arguments[0] !== undefined && ts.isObjectLiteralExpression(n.arguments[0])){
                        for (const p of n.arguments[0].properties){
                            const value = ts.isShorthandPropertyAssignment(p) ? checker.getShorthandAssignmentValueSymbol(p) : ts.isPropertyAssignment(p) ? checker.getSymbolAtLocation(p.initializer) : undefined;
                            if (canonical(value) === T) add(sf, p, "provider");
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }
    return { files: [...new Set(sites.map((s) => s.file))].sort(compare), sites: sites.sort((a, b) => compare(a.file, b.file) || a.line - b.line) };
}
