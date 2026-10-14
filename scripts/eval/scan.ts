/**
 * The eval's ground truth for imports (R3 in docs/plans/2026-10-13-v1-5-ship.md): a regex over the source and its own
 * relative-path resolution. It imports nothing from lib/, so the truth never comes from Nebulosity's index. Its false
 * hits (an import inside a string or a block comment) and misses (a non-relative specifier) are found by reading the
 * source in Task 17, never by asking the indexer.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/** import … from '…', export … from '…', import '…', import('…'), require('…'). */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"\n]+)['"]/gm;
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/** TypeScript's pairs: a .js specifier names the .ts file next to it once compiled, and so on. */
const COMPILED_FROM: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** The specifiers a file imports, in order. Lines starting with // or * are skipped as comments. */
export function importSpecifiers(text: string): string[] {
    const code = text.split(/\r?\n/).filter((line) => !/^\s*(?:\/\/|\*)/.test(line)).join("\n");
    return [...code.matchAll(SPECIFIER)].map((m) => m[1]);
}

/** A relative specifier as a file the repo has, or null: its TypeScript source, itself, an added extension, or an index file. */
export function resolveRelative(fromFile: string, specifier: string, known: ReadonlySet<string>): string | null {
    if (!specifier.startsWith(".")) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    const ext = path.posix.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    const candidates = [
        ...(COMPILED_FROM[ext] ?? []).map((e) => stem + e),
        ...(CODE_FILE.test(base) ? [base] : []),
        ...EXTENSIONS.map((e) => base + e),
        ...EXTENSIONS.map((e) => `${base}/index${e}`),
    ];
    return candidates.find((c) => known.has(c)) ?? null;
}

export type ScannedGraph = { files: string[]; edges: [string, string][] };

/** Every code file git tracks under root, and every import between them the regex finds and resolves (each pair once). */
export function scanRepo(root: string): ScannedGraph {
    const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        .split("\0")
        .filter((f) => CODE_FILE.test(f));
    const known = new Set(files);
    const edges: [string, string][] = [];
    for (const file of files){
        const seen = new Set<string>();
        for (const specifier of importSpecifiers(fs.readFileSync(path.join(root, file), "utf8"))){
            const target = resolveRelative(file, specifier, known);
            if (target !== null && target !== file && !seen.has(target)){
                seen.add(target);
                edges.push([file, target]);
            }
        }
    }
    return { files, edges };
}
