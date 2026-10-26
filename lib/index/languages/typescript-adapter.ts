import type { LanguageAdapter, LanguageResolver, ResolveContext } from "./adapter";
import { createResolver, createSourceFinder } from "../resolve";
import { normalizeSlashes } from "../paths";
import { declaredEntries, readWorkspace, type Workspace } from "../workspace";
import { ADAPTER_VERSION, parseTypeScriptFile, parseTypeScriptImportsOnly, scanTypeScriptImports } from "./typescript";
import { MANIFEST, typescriptRules } from "./typescript-rules";

/** Where TypeScript keeps the workspace it read from the manifests, across a worker's updates (ADR-053, amended). */
const WORKSPACE_KEY = "typescript:workspace";

const isRelative = (s: string): boolean => s === "." || s === ".." || s.startsWith("./") || s.startsWith("../");

/**
 * typescript.ts behind the seam (ADR-065): the same parse, the same resolver and the same entry points as before E4,
 * so every TypeScript and JavaScript file's stored facts stay exactly as they were.
 */
export const typescriptAdapter: LanguageAdapter = {
    ...typescriptRules,
    version: ADAPTER_VERSION,
    grammar: null,

    parse(path, text, reading){
        const parsed = reading === "scan" ? scanTypeScriptImports(path, text)
            : reading === "parse" ? parseTypeScriptImportsOnly(path, text)
            : parseTypeScriptFile(path, text);
        return { ...parsed, declares: [] };
    },

    createResolver(ctx: ResolveContext): LanguageResolver {
        let workspace = ctx.cache.get(WORKSPACE_KEY) as Workspace | undefined;
        if (workspace === undefined){
            // only its own manifests: readWorkspace reads every non-package.json manifest as a tsconfig, so a go.mod
            // would become a module-id root
            workspace = readWorkspace(ctx.root, ctx.manifests.filter((m) => MANIFEST.test(m)));
            ctx.cache.set(WORKSPACE_KEY, workspace);
        }
        // Its own files only, as before E4: a specifier like "./build.py" names no TypeScript import target, and an edge
        // from TypeScript into another language's file would change TypeScript's stored edges in a mixed repo.
        const fileSet = new Set(ctx.files.keys());
        const resolveOne = createResolver(ctx.root, fileSet, { workspace });
        const ws = workspace;
        return {
            resolve(importer, specifier){
                const target = resolveOne(importer, specifier);
                return target === null ? [] : [target];
            },
            kindOf(importer, specifier){
                return isRelative(normalizeSlashes(specifier)) || resolveOne(importer, specifier) !== null ? "internal" : "external";
            },
            entryPoints(){
                return declaredEntries(ws, createSourceFinder(fileSet, ws));
            },
        };
    },
};
