import fs from "fs";
import { builtinModules } from "module";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The extension's layering (V1.8 plan P3 and P11). It talks to the Map only over HTTP and the editor bridge, so its one
 * import from the rest of the repo is `import type` from lib/contracts.ts, which the compiler erases from the bundle.
 * Everything else it imports is inside vscode-extension/, Node's own modules, or `vscode`; nothing comes through the
 * root's "@/" alias. It has no runtime dependencies (`dependencies: {}`), and a package name would still resolve by
 * walking up into the root's node_modules, where esbuild would bundle it unseen, so only a test may name one (vitest,
 * which runs it, and typescript, which this file parses with). The pure modules, which the root vitest runs, never
 * import `vscode`: that module exists only inside VS Code's extension host.
 */
const SRC = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(SRC, "..");
const EXTENSION_MODULES = path.join(EXTENSION, "node_modules");
const CONTRACTS = path.resolve(EXTENSION, "..", "lib", "contracts");
/** The files that run in the extension host and use VS Code's API. Every other file under src/ is pure. */
const HOST = ["extension.ts", "http.ts", "mapServer.ts", "panel.ts", "sync.ts"];
/** Packages a test file may import. */
const TEST_PACKAGES = ["vitest", "typescript"];
const PURE_MODULES = ["ports.ts", "command.ts", "serverCheck.ts", "repoMatch.ts", "followGate.ts", "dependents.ts", "syncRules.ts", "messageLog.ts", "guards.ts"];

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

const isUnder = (target: string, dir: string): boolean => target === dir || target.startsWith(dir + path.sep);

/** What breaks the layering in one file under src/ (its path from src/, forward slashes), each with the reason. */
function violations(file: string, source: string): string[] {
    const pure = !HOST.includes(file);
    const test = file.endsWith(".test.ts");
    const found: string[] = [];
    for (const { specifier, typeOnly } of moduleRefs(source)){
        if (specifier === "<dynamic>"){
            found.push("a module named at run time, which can't be checked");
        } else if (specifier === "@" || specifier.startsWith("@/")){
            found.push(`${specifier}: the root's "@/" alias`);
        } else if (specifier.startsWith(".") || path.isAbsolute(specifier)){
            const target = path.resolve(SRC, path.dirname(file), specifier);
            // a path into node_modules is a package by another name
            const inside = isUnder(target, EXTENSION) && !isUnder(target, EXTENSION_MODULES);
            if (!inside && !(typeOnly && target === CONTRACTS)){
                found.push(`${specifier}: outside vscode-extension/, only \`import type\` from lib/contracts`);
            }
        } else if (specifier === "vscode"){
            if (pure) found.push("vscode, in a pure file");
        } else if (!specifier.startsWith("node:") && !builtinModules.includes(specifier) && !(test && TEST_PACKAGES.includes(specifier))){
            found.push(`${specifier}: a package, and the extension has no runtime dependencies`);
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
    it("imports from outside vscode-extension/ only types from lib/contracts, no package, and vscode only in the host files", () => {
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
        expect(violations("webview/relay.ts", 'import { DEFAULT_PORT } from "../ports";')).toEqual([]);
        expect(violations("mapServer.ts", 'import { spawn } from "child_process";\nimport fs from "node:fs";\nimport { readFile } from "fs/promises";')).toEqual([]);
        expect(violations("ports.test.ts", 'import { it } from "vitest";\nimport ts from "typescript";')).toEqual([]);
        expect(violations("panel.ts", 'import { x } from "../../app/map/embed";')).toHaveLength(1);
        expect(violations("ports.ts", 'import type { X } from "../../app/map/embed";')).toHaveLength(1);
        expect(violations("ports.ts", 'import { y } from "../../scripts/cli";')).toHaveLength(1);
        expect(violations("ports.ts", 'import z from "zod";')).toHaveLength(1);
        expect(violations("ports.ts", 'import z from "../node_modules/zod";')).toHaveLength(1);
        expect(violations("ports.ts", 'import { it } from "vitest";')).toHaveLength(1);
        expect(violations("ports.ts", 'import { type RepoList } from "../../lib/contracts";')).toHaveLength(1);
        expect(violations("ports.ts", 'import { BRIDGE_VERSION } from "../../lib/contracts";')).toHaveLength(1);
        expect(violations("ports.ts", 'import type { ReachAnswer } from "../../lib/engine/reach";')).toHaveLength(1);
        expect(violations("ports.ts", 'import type { RepoList } from "@/lib/contracts";')).toHaveLength(1);
        expect(violations("ports.ts", 'import * as vscode from "vscode";')).toHaveLength(1);
        expect(violations("webview/relay.ts", 'import * as vscode from "vscode";')).toHaveLength(1);
        expect(violations("http.ts", 'const m = require(name);')).toHaveLength(1);
    });
});
