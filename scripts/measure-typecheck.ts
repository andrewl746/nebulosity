/**
 * npm run measure-typecheck -- <path-to-repo> [--project <tsconfig, repo-relative>] [--sample <n>]
 *
 * E2's measurement (ADR-043): what a type-checked call graph would cost. It builds TypeScript's program for one tsconfig
 * project (src/tsconfig.json for VS Code), times it and reads the process's memory, then resolves a sample of method
 * calls to their declarations, as a call graph through injected services would. A call that resolves to an interface
 * method is the dependency-injection case. For each one it counts the classes that `implements` that interface
 * (syntactically): one means the call's target is known, several mean it's one of them. Read-only. Run it with a big
 * heap: node --max-old-space-size=16384 --import tsx scripts/measure-typecheck.ts ../vscode
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const args = process.argv.slice(2);
const repo = args[0];
if (!repo){
    console.error("usage: npm run measure-typecheck -- <path-to-repo> [--project <tsconfig>] [--sample <n>]");
    process.exit(1);
}
const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
};
const root = path.resolve(repo);
const project = path.join(root, flag("--project") ?? "src/tsconfig.json");
const sampleSize = Number(flag("--sample") ?? "2000");
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const memory = (): string => {
    const m = process.memoryUsage();
    return `heap ${mb(m.heapUsed)}, rss ${mb(m.rss)}`;
};

const parsed = ts.getParsedCommandLineOfConfigFile(project, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
});
if (!parsed) throw new Error(`couldn't read ${project}`);

let t = performance.now();
const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
const programMs = performance.now() - t;
console.log(`[typecheck] program: ${parsed.fileNames.length} root files, ${program.getSourceFiles().length} source files in all, ${(programMs / 1000).toFixed(1)} s, ${memory()}`);

t = performance.now();
const checker = program.getTypeChecker();
const ours = program.getSourceFiles()
    .filter((f) => !f.isDeclarationFile && path.resolve(f.fileName).startsWith(root))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : 1));

// interface name → how many classes say they implement it (syntactic, by name: what E2's heuristic fallback would see)
const implementers = new Map<string, number>();
const calls: ts.CallExpression[] = [];
for (const file of ours){
    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node)){
            for (const clause of node.heritageClauses ?? []){
                if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
                for (const type of clause.types){
                    const name = type.expression.getText(file);
                    implementers.set(name, (implementers.get(name) ?? 0) + 1);
                }
            }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) calls.push(node);
        ts.forEachChild(node, visit);
    };
    visit(file);
}
const step = Math.max(1, Math.floor(calls.length / sampleSize));
const sample = calls.filter((_, i) => i % step === 0).slice(0, sampleSize);

const counts = { interfaceMethod: 0, classMethod: 0, other: 0, unresolved: 0, oneImplementer: 0, severalImplementers: 0, noImplementer: 0 };
for (const call of sample){
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!declaration){ counts.unresolved++; continue; }
    const owner = declaration.parent;
    if (owner && ts.isInterfaceDeclaration(owner)){
        counts.interfaceMethod++;
        const n = implementers.get(owner.name.text) ?? 0;
        if (n === 1) counts.oneImplementer++;
        else if (n > 1) counts.severalImplementers++;
        else counts.noImplementer++;
    } else if (owner && ts.isClassDeclaration(owner)) counts.classMethod++;
    else counts.other++;
}
const sampleMs = performance.now() - t;
const usage = process.resourceUsage();
const result = {
    repo: path.basename(root), project: path.relative(root, project), rootFiles: parsed.fileNames.length,
    sourceFiles: program.getSourceFiles().length, programSeconds: +(programMs / 1000).toFixed(1),
    methodCalls: calls.length, sampled: sample.length, sampleSeconds: +(sampleMs / 1000).toFixed(1),
    perCallMs: +(sampleMs / Math.max(1, sample.length)).toFixed(2), ...counts,
    peakRssMb: Math.round(usage.maxRSS / 1024), heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
};
console.log(`[typecheck] ${calls.length} method calls; sampled ${sample.length} in ${result.sampleSeconds} s (${result.perCallMs} ms each), ${memory()}`);
console.log(JSON.stringify(result, null, 2));
const out = path.resolve(__dirname, "..", ".nebulosity", "measure");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `typecheck-${result.repo}.json`), JSON.stringify(result, null, 2) + "\n");
