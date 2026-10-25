import type { LanguageRules } from "./adapter";

// TypeScript's pure rules (ADR-065): no compiler loaded here, so discovery, the watcher and the engine can read them.

/** Every extension this adapter claims (TypeScript parses JavaScript too). */
export const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** files.language for a path this adapter claims. TypeScript's parser reads both languages. */
export function languageOf(filePath: string): "typescript" | "javascript" {
    return /\.(js|jsx|mjs|cjs)$/.test(filePath) ? "javascript" : "typescript";
}

/** A package.json or a tsconfig*.json (tsconfig.json, tsconfig.base.json, …): what resolving bare specifiers reads (ADR-053). */
export const MANIFEST = /(^|\/)(package\.json|tsconfig[^/]*\.json)$/;

export const typescriptRules: LanguageRules = {
    id: "typescript",
    extensions: TYPESCRIPT_EXTENSIONS,
    languageOf,
    isTest: (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path),
    manifest: MANIFEST,
    // node_modules is left out for every language by discovery itself (IGNORED_DIRS)
    excluded: () => () => false,
};
