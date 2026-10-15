/**
 * The eval's ground truth for imports (R3 in docs/plans/2026-10-13-v1-5-ship.md, R2 in V1.6's plan): a regex over the source
 * and its own path resolution. It imports nothing from lib/, so the truth never comes from Nebulosity's index. Its false
 * hits (an import inside a string or a block comment) and misses are found by reading the source, never by asking the
 * indexer. Non-relative specifiers resolve only through a resolver the caller passes (scripts/eval/resolve-truth.ts, the
 * eval's own reading of ADR-053); without one they stay unresolved, as Eval #1's truths were built.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// import … from '…', export … from '…', import '…' (also minified, import'…'), import('…'), require('…').
// Block comments between import( and the quote (a bundler's webpackChunkName hint) are skipped.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*(?:\/\*.*?\*\/\s*)*|\brequire\s*\(\s*|^\s*import\s*)['"]([^'"\n]+)['"]/gm;
// import(<identifier>): a computed import whose address the regex can't read, listed for a reader to decide (R2).
const COMPUTED = /\bimport\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
const COMMENT_LINE = /^\s*(?:\/\/|\*)/;
export const CODE_FILE = /\.[cm]?[jt]sx?$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/** TypeScript's pairs: a .js specifier names the .ts file next to it once compiled, and so on. */
const COMPILED_FROM: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** The specifiers a file imports, in order. Lines starting with // or * are skipped as comments. */
export function importSpecifiers(text: string): string[] {
    const code = text.split(/\r?\n/).filter((line) => !COMMENT_LINE.test(line)).join("\n");
    return [...code.matchAll(SPECIFIER)].map((m) => m[1]);
}

/**
 * A repo path as a file the repo has, or null. In order: its TypeScript source, itself, an added extension, an index file,
 * and last a .d.ts declaration file (so a real source file of the same name always wins). "" is the repo root, whose only
 * candidates are its index files.
 */
export function resolvePath(base: string, known: ReadonlySet<string>): string | null {
    const folder = base === "" ? "" : `${base}/`;
    const ext = path.posix.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    const candidates = [
        ...(COMPILED_FROM[ext] ?? []).map((e) => stem + e),
        ...(CODE_FILE.test(base) ? [base] : []),
        ...(base === "" ? [] : EXTENSIONS.map((e) => base + e)),
        ...EXTENSIONS.map((e) => `${folder}index${e}`),
        ...(ext in COMPILED_FROM ? [`${stem}.d.ts`] : []),
        ...(base === "" ? [] : [`${base}.d.ts`]),
        `${folder}index.d.ts`,
    ];
    return candidates.find((c) => known.has(c)) ?? null;
}

/**
 * A relative specifier as a file the repo has, or null (resolvePath's order). A trailing slash is dropped, and a path that
 * comes out as "." (import '..' from a file one folder down) is the repo root.
 */
export function resolveRelative(fromFile: string, specifier: string, known: ReadonlySet<string>): string | null {
    if (!specifier.startsWith(".")) return null;
    const joined = path.posix.join(path.posix.dirname(fromFile), specifier).replace(/\/+$/, "");
    return resolvePath(joined === "." ? "" : joined, known);
}

/** A non-relative specifier's file, as the eval's own resolver reads it; null when it names nothing in the repo. */
export type ResolveBare = (fromFile: string, specifier: string) => string | null;

/** A specifier as a file: a relative one by resolveRelative, any other only through `resolveBare` when one is given. */
export function resolveSpecifier(fromFile: string, specifier: string, known: ReadonlySet<string>, resolveBare?: ResolveBare): string | null {
    if (specifier.startsWith(".")) return resolveRelative(fromFile, specifier, known);
    return resolveBare ? resolveBare(fromFile, specifier) : null;
}

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every file under root, as repo paths with forward slashes: what git tracks when root is a checkout (it has a .git, a folder
 * or a worktree's file), else a walk of the folder that never enters .git or node_modules. Sorted, so the walk is stable.
 */
export function listFiles(root: string): string[] {
    if (fs.existsSync(path.join(root, ".git"))){
        return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
            .split("\0").filter((f) => f !== "");
    }
    const files: string[] = [];
    const walk = (folder: string): void => {
        for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })){
            const rel = folder === "" ? entry.name : `${folder}/${entry.name}`;
            if (entry.isDirectory()){
                if (entry.name !== "node_modules" && entry.name !== ".git") walk(rel);
            } else if (entry.isFile()) files.push(rel);
        }
    };
    walk("");
    return files.sort(byPath);
}

export type ScannedGraph = { files: string[]; edges: [string, string][] };

/**
 * Every code file under root (listFiles), and every import between them the regex finds and resolves, each pair once.
 * Non-relative specifiers resolve through `options.resolveBare` (none by default, so Eval #1's truths rebuild unchanged).
 */
export function scanRepo(root: string, options: { resolveBare?: ResolveBare } = {}): ScannedGraph {
    const files = listFiles(root).filter((f) => CODE_FILE.test(f));
    const known = new Set(files);
    const edges: [string, string][] = [];
    for (const file of files){
        const seen = new Set<string>();
        for (const specifier of importSpecifiers(fs.readFileSync(path.join(root, file), "utf8"))){
            const target = resolveSpecifier(file, specifier, known, options.resolveBare);
            if (target !== null && target !== file && !seen.has(target)){
                seen.add(target);
                edges.push([file, target]);
            }
        }
    }
    return { files, edges };
}

export type ComputedSite = { file: string; line: number; expression: string };

/**
 * Every import(<identifier>) in the given files, with its line: the computed imports neither extractor can follow, which a
 * reader decides (R2). Comment lines are skipped as importSpecifiers skips them (blanked, so the line numbers stay right).
 */
export function computedSites(root: string, files: readonly string[]): ComputedSite[] {
    const sites: ComputedSite[] = [];
    for (const file of files){
        const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
        const code = lines.map((line) => (COMMENT_LINE.test(line) ? "" : line)).join("\n");
        for (const m of code.matchAll(COMPUTED)){
            const line = code.slice(0, m.index ?? 0).split("\n").length;
            sites.push({ file, line, expression: m[1] });
        }
    }
    return sites.sort((a, b) => byPath(a.file, b.file) || a.line - b.line);
}
