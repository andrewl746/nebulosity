import type { LanguageRules } from "./adapter";
import { csharpRules } from "./csharp/rules";
import { goRules } from "./go/rules";
import { javaRules } from "./java/rules";
import { pythonRules } from "./python/rules";
import { rustRules } from "./rust/rules";
import { typescriptRules } from "./typescript-rules";

/**
 * Every language's pure rules, in the registry's order (ADR-065). Pure means no parser and no file system: discovery,
 * the watcher, isTestPath and the engine import this module, so the MCP server and the Next server never load a
 * grammar. The UI imports none of it (ARCHITECTURE.md §3 rule 3).
 */
export const RULES: readonly LanguageRules[] = [typescriptRules, pythonRules, goRules, javaRules, csharpRules, rustRules];

/** The rules claiming a path: the longest claimed extension it ends with (case-sensitive), or null when none does. */
export function rulesFor<R extends LanguageRules>(path: string, rules: readonly R[] = RULES as readonly R[]): R | null {
    let found: R | null = null;
    let longest = 0;
    for (const r of rules){
        for (const ext of r.extensions){
            if (ext.length > longest && path.endsWith(ext)){
                found = r;
                longest = ext.length;
            }
        }
    }
    return found;
}

/** Every claimed extension, in the rules' order, each once: what discovery lists as code. */
export function claimedExtensions(rules: readonly LanguageRules[] = RULES): string[] {
    return [...new Set(rules.flatMap((r) => r.extensions))];
}

/** Whether any language counts this repo-relative path as a manifest. */
export function isManifestPath(path: string, rules: readonly LanguageRules[] = RULES): boolean {
    return rules.some((r) => r.manifest.test(path));
}

/**
 * The code files the manifests leave out (a virtual environment, a vendor/ or target/ folder beside its manifest), each
 * language deciding for its own files only: a TypeScript file in a Go module's vendor/ folder stays.
 */
export function exclusionFor(manifests: readonly string[], rules: readonly LanguageRules[] = RULES): (path: string) => boolean {
    const byRules = new Map(rules.map((r) => [r, r.excluded(manifests)] as const));
    return (path) => {
        const r = rulesFor(path, rules);
        return r !== null && byRules.get(r)!(path);
    };
}
