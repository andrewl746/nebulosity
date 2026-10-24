import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The extension's layering (V1.8 plan P3 and P11). It talks to the Map only over HTTP and the editor bridge, so its one
 * import from lib/ is `import type` from lib/contracts.ts, which the compiler erases from the bundle, and nothing comes
 * through the root's "@/" alias. The pure modules, which the root vitest runs, never import `vscode`: that module exists
 * only inside VS Code's extension host.
 */
const SRC = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(SRC, "..", "..", "lib");
const CONTRACTS = path.join(LIB, "contracts");
/** The files that run in the extension host and use VS Code's API. Every other file under src/ is pure. */
const HOST = ["extension.ts", "http.ts", "mapServer.ts", "panel.ts", "sync.ts"];
const PURE_MODULES = ["ports.ts", "command.ts", "serverCheck.ts", "repoMatch.ts", "followGate.ts", "dependents.ts"];

type ModuleRef = { specifier: string; typeOnly: boolean };

/**
 * Every module a source names, read by the TypeScript parser: import and export declarations with a module (a side-effect
 * import included), `import x = require()`, `require()` and `import()` calls, and `import("x")` types. `typeOnly` is true
 * for `import type …`, `export type …` and an `import("x")` type, which the compiler erases. `import { type X }` is not:
 * the import itself stays in the output. A require or import() of something other than a plain string is "<dynamic>".
 */
function moduleRefs(source: string): ModuleRef[] {
    const refs: ModuleRef[] = [];
    const named = (node: ts.Node | undefined): string => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : "<dynamic>");
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)){
            refs.push({ specifier: named(node.moduleSpecifier), typeOnly: node.importClause?.isTypeOnly === true });
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined){
            refs.push({ specifier: named(node.moduleSpecifier), typeOnly: node.isTypeOnly });
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)){
            refs.push({ specifier: named(node.moduleReference.expression), typeOnly: node.isTypeOnly });
        } else if (ts.isCallExpression(node)
            && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))){
            refs.push({ specifier: named(node.arguments[0]), typeOnly: false });
        } else if (ts.isImportTypeNode(node)){
            refs.push({ specifier: ts.isLiteralTypeNode(node.argument) ? named(node.argument.literal) : "<dynamic>", typeOnly: true });
        }
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true));
    return refs;
}

/** What breaks the layering in one file under src/ (its path from src/, forward slashes), each with the reason. */
function violations(file: string, source: string): string[] {
    const pure = !HOST.includes(file);
    const found: string[] = [];
    for (const { specifier, typeOnly } of moduleRefs(source)){
        if (specifier === "<dynamic>"){
            found.push("a module named at run time, which can't be checked");
        } else if (specifier === "@" || specifier.startsWith("@/")){
            found.push(`${specifier}: the root's "@/" alias`);
        } else if (specifier.startsWith(".") || path.isAbsolute(specifier)){
            const target = path.resolve(SRC, path.dirname(file), specifier);
            const inLib = target === LIB || target.startsWith(LIB + path.sep);
            if (inLib && !(typeOnly && target === CONTRACTS)) found.push(`${specifier}: from lib/, only \`import type\` from lib/contracts`);
        } else if (pure && specifier === "vscode"){
            found.push("vscode, in a pure file");
        }
    }
    return found;
}

/** Every .ts file under src/, as its path from src/ with forward slashes. */
function sourceFiles(): string[] {
    return fs.readdirSync(SRC, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts"))
        .map((file) => file.split(path.sep).join("/"))
        .sort();
}

describe("the extension's layering (V1.8 plan P3, P11)", () => {
    it("imports from lib/ only types from lib/contracts, nothing through @/, and vscode only in the host files", () => {
        const files = sourceFiles();
        // a scan that found nothing would pass everything below
        for (const pure of PURE_MODULES) expect(files).toContain(pure);
        for (const file of files){
            expect({ file, violations: violations(file, fs.readFileSync(path.join(SRC, file), "utf8")) }).toEqual({ file, violations: [] });
        }
        // a reader that stopped seeing imports would pass too, so the one allowed import must be seen
        expect(moduleRefs(fs.readFileSync(path.join(SRC, "dependents.ts"), "utf8"))).toContainEqual({ specifier: "../../lib/contracts", typeOnly: true });
    });

    it("reads every way a source names a module", () => {
        const source = [
            'import type { A } from "../../lib/contracts";',
            'import { type B } from "../../lib/contracts";',
            'import * as vscode from "vscode";',
            'import "./side";',
            'export type { C } from "./c";',
            'export * from "./d";',
            'import e = require("./e");',
            'const f = require("./f");',
            'const g = await import("./g");',
            'type H = typeof import("./h");',
            "const i = require(name);",
            'const from = "not a module";',
        ].join("\n");
        expect(moduleRefs(source)).toEqual([
            { specifier: "../../lib/contracts", typeOnly: true },
            { specifier: "../../lib/contracts", typeOnly: false },
            { specifier: "vscode", typeOnly: false },
            { specifier: "./side", typeOnly: false },
            { specifier: "./c", typeOnly: true },
            { specifier: "./d", typeOnly: false },
            { specifier: "./e", typeOnly: false },
            { specifier: "./f", typeOnly: false },
            { specifier: "./g", typeOnly: false },
            { specifier: "./h", typeOnly: true },
            { specifier: "<dynamic>", typeOnly: false },
        ]);
    });

    it("tells an allowed import from a refused one", () => {
        expect(violations("ports.ts", 'import type { RepoList } from "../../lib/contracts";')).toEqual([]);
        expect(violations("webview/relay.ts", 'import type { BridgeToMap } from "../../../lib/contracts";')).toEqual([]);
        expect(violations("panel.ts", 'import * as vscode from "vscode";')).toEqual([]);
        expect(violations("ports.ts", 'import { type RepoList } from "../../lib/contracts";')).toHaveLength(1);
        expect(violations("ports.ts", 'import { BRIDGE_VERSION } from "../../lib/contracts";')).toHaveLength(1);
        expect(violations("ports.ts", 'import type { ReachAnswer } from "../../lib/engine/reach";')).toHaveLength(1);
        expect(violations("ports.ts", 'import type { RepoList } from "@/lib/contracts";')).toHaveLength(1);
        expect(violations("ports.ts", 'import * as vscode from "vscode";')).toHaveLength(1);
        expect(violations("webview/relay.ts", 'import * as vscode from "vscode";')).toHaveLength(1);
        expect(violations("http.ts", 'const m = require(name);')).toHaveLength(1);
    });
});
