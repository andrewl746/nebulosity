import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db/client";
import { replaceEntryPoints } from "../db/store/entries";
import { acquireIndexLock, releaseIndexLock } from "../db/store/lock";
import { fillCodeSearch, isCodeSearchDeferred } from "../db/store/search";
import { writeStage } from "../db/store/stages";
import {
    applyEdgeChanges, deleteFiles, loadImportEdges, loadImportEdgesFrom, loadImportEdgesTouching, loadStoredFiles,
    markIndexed, requireRepository, syncFolders, writeFileRecords,
    type FileError, type FileRecord, type ImportEdge,
} from "../db/store/structure";
import { pruneSummaries } from "../db/store/summaries";
import { bumpIndexVersion, readIndexVersion } from "../db/store/version";
import { buildFolders, levelEdgeDeltas } from "./aggregate";
import { discoverFiles, gitIgnored, isExcludedPath, listManifests, readGitHead, readingFor, type FileReading } from "./discover";
import type { LanguageAdapter, LanguageRules } from "./languages/adapter";
import { ADAPTERS, adapterFor } from "./languages/registry";
import { createResolvers, edgesOf, entryPointsOf, type ResolutionState } from "./languages/resolution";
import { claimedExtensions, exclusionFor, isManifestPath, RULES } from "./languages/rules";
import { normalizeSlashes, repoKey } from "./paths";
import { assertGrammarsLoaded, repoTextReader, structureNote, toFileRecord } from "./pipeline";

export type FileChangeResult = {
    repoId: number;
    /** Files whose new bytes are now indexed: edited or created. */
    changed: string[];
    /** Files that left the index: deleted, renamed away, now ignored, or grown past the hard bound (a file over the size cap stays, imports only). */
    deleted: string[];
    /** Paths that needed nothing: the same bytes, or never a source file. */
    unchanged: number;
    errors: FileError[];
    /** Files whose adapter's parse threw, read by the scan instead and in the index with their imports (IndexResult's `scanned`). */
    scanned: FileError[];
    /**
     * Every file's imports were re-resolved: the file set changed, or a manifest of any language, a tsconfig, a package.json
     * or a workspace declaration did (ADR-037, ADR-053, ADR-065).
     */
    resolvedAll: boolean;
    edgesAdded: number;
    edgesRemoved: number;
    totalMs: number;
    /** The repo's index version afterwards: it moves only when something changed. */
    indexVersion: number;
    /**
     * The manifests and the adapters' cache (TypeScript's workspace) the imports were resolved with: pass it back next time
     * and it is reused unless a manifest, a resolution input or the file set changed (ADR-053 amended, ADR-065).
     */
    resolution: ResolutionState;
};

/**
 * A tsconfig or a package.json decides what bare specifiers resolve to everywhere below it, and the root's
 * pnpm-workspace.yaml or lerna.json which packages may be named (ADR-053).
 */
const RESOLUTION_INPUT = /(^|\/)(tsconfig[^/]*|package)\.json$|^(pnpm-workspace\.yaml|lerna\.json)$/;

/**
 * Whether a changed path re-resolves every file's imports: TypeScript's resolution inputs (a tsconfig, a package.json, a
 * workspace declaration), or any language's manifest (a go.mod, a Cargo.toml, a .csproj…, ADR-065).
 */
export function resolvesEverything(changedPath: string, rules: readonly LanguageRules[] = RULES): boolean {
    return RESOLUTION_INPUT.test(changedPath) || isManifestPath(changedPath, rules);
}

/**
 * The incremental structure update (PIVOT_SPEC.md §5.6, ADR-037): what the background worker runs for the paths a
 * watcher reported, as repo-relative paths. Each path is looked at as it is now.
 * - An edited file is re-parsed and its own imports re-resolved.
 * - A created or deleted file, or a changed manifest of any language (a tsconfig, a package.json, a go.mod…) or workspace
 *   declaration, re-resolves every file's imports in memory: a new file can be what "../core" now means. The declared
 *   entry points are computed again then too.
 * - An edited file whose declares changed (a Go file's package-level names, a Java file's types, ADR-065) re-resolves
 *   every file of its language, since any of them may name what it declares, and the entry points are computed again.
 * - A manifest added or deleted re-applies the files it leaves out, both ways, as a full run would.
 * Either way only the differences are written (import rows, level-edge counts, folder counts), so the result is what a
 * full run would store, without rewriting VS Code's 139,580 unchanged imports.
 * A file over the size cap is read for its imports only, and one past the hard bound leaves the index, as in a full run.
 */
export function applyFileChanges(
    repoRoot: string, changedPaths: readonly string[],
    options: {
        maxFileBytes?: number; parseMaxFileBytes?: number; hardMaxFileBytes?: number;
        resolution?: ResolutionState; adapters?: readonly LanguageAdapter[];
    } = {}
): FileChangeResult {
    const started = performance.now();
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const caps = { maxBytes: options.maxFileBytes, parseMaxBytes: options.parseMaxFileBytes, hardMaxBytes: options.hardMaxFileBytes };
    const usedGit = fs.existsSync(path.join(root, ".git"));
    const adapters = options.adapters ?? ADAPTERS;
    const extensions = claimedExtensions(adapters);
    const previous = options.resolution;

    acquireIndexLock(db);
    try{
        // a bulk run that died before filling code search left it deferred: repair that before anything else
        if (isCodeSearchDeferred(db)) fillCodeSearch(db);

        const stored = loadStoredFiles(db, repoId);
        let paths = expandFolders(changedPaths, stored);

        // Which files a language leaves out depends on the manifests (ADR-065). The kept list is reused unless a path could
        // change it: a manifest or resolution input, or a path the index doesn't hold (a new file, a deleted folder).
        const freshManifests = previous === undefined || paths.some((p) => resolvesEverything(p, adapters) || !stored.has(p))
            ? listManifests(root, adapters)
            : null;
        const manifests = freshManifests ?? previous!.manifests;
        const exclude = exclusionFor(manifests, adapters);
        const excluded = (rel: string): boolean => isExcludedPath(rel, { extensions, usedGit, exclude });

        // A manifest added or deleted re-applies the exclusions both ways, as a full run would: files it now leaves out
        // leave the index, and files it no longer leaves out are found by listing the repo's files again.
        const manifestsMoved = previous === undefined ? paths.some((p) => isManifestPath(p, adapters)) : !sameList(previous.manifests, manifests);
        if (manifestsMoved){
            const nowExcluded = [...stored.keys()].filter(excluded);
            const found = discoverFiles(root, { rules: adapters, ...caps }).files.map((f) => f.path).filter((p) => !stored.has(p));
            paths = [...new Set([...paths, ...nowExcluded, ...found])].sort();
        }

        // a new path .gitignore excludes never entered the index; one git call answers for all of them
        const ignored = usedGit ? gitIgnored(root, paths.filter((p) => !stored.has(p) && !excluded(p))) : new Set<string>();

        const pending: { rel: string; text: string; contentHash: string; size: number; reading: Exclude<FileReading, "skip"> }[] = [];
        const gone: string[] = [];
        const errors: FileError[] = [];
        let unchanged = 0;

        for (const rel of paths){
            const size = fileSize(path.join(root, rel));
            const reading = size === null ? "skip" : readingFor(size, caps);
            if (size === null || reading === "skip" || excluded(rel) || ignored.has(rel)){
                // not a source file now: if the index has it, it goes
                if (stored.has(rel)) gone.push(rel);
                else unchanged++;
                continue;
            }

            let text: string;
            try{
                text = fs.readFileSync(path.join(root, rel), "utf8");
            } catch (err){
                errors.push({ path: rel, error: messageOf(err) });
                continue;
            }

            const contentHash = createHash("sha256").update(text).digest("hex");
            // ADR-022: the hash means "the indexer last processed exactly these bytes"
            if (stored.get(rel)?.contentHash === contentHash){
                unchanged++;
                continue;
            }
            pending.push({ rel, text, contentHash, size, reading });
        }

        // the guard (ADR-065): before anything is parsed, so nothing is written when a file's grammar isn't loaded
        assertGrammarsLoaded(new Set(pending.flatMap((p) => adapterFor(p.rel, adapters) ?? [])));

        const records: FileRecord[] = [];
        const scanned: FileError[] = [];
        for (const p of pending){
            try{
                records.push(toFileRecord(p.rel, p.text, p.contentHash, p.size, {
                    ...(p.reading === "full" ? {} : { importsOnly: p.reading }), adapters,
                    onScanned: (error) => scanned.push({ path: p.rel, error }),   // a parse that threw, read by the scan (B-I1)
                }));
            } catch (err){
                errors.push({ path: p.rel, error: messageOf(err) });
            }
        }

        const writeErrors = writeFileRecords(db, repoId, records);
        errors.push(...writeErrors);
        const failed = new Set(writeErrors.map((e) => e.path));
        const written = records.filter((r) => !failed.has(r.path));
        const changed = written.map((r) => r.path);

        // deleting a file cascades its imports away: capture them first, for the level-edge counts
        const cascaded = loadImportEdgesTouching(db, repoId, gone);
        const deleted = deleteFiles(db, repoId, gone);

        const fileSetChanged = changed.some((p) => !stored.has(p)) || deleted.length > 0;
        // manifestsMoved too (the E4 final review's m6): a folder reported as a folder, holding a manifest and no indexed
        // file, deleted, changes the manifest list with no manifest among the paths and no file set change; without it the
        // old manifests and cache were kept, against adapter.ts's "emptied whenever a manifest changes", and every later
        // update saw the lists differ and listed the whole repo again (a cost per save, until the next full run)
        const resolvedAll = fileSetChanged || manifestsMoved || paths.some((p) => resolvesEverything(p, adapters));
        // ADR-053, amended (V1.7), widened (ADR-065): the worker keeps the resolution state it was given back. It starts
        // again only when what it is made of can have changed: a manifest or resolution input, or the file set (a folder
        // with a package.json deleted). TypeScript's workspace, read afresh, costs about 0.28 s on VS Code, most of it one
        // git ls-files; a repo without git is walked whole.
        const resolution: ResolutionState = resolvedAll || previous === undefined
            ? { manifests: freshManifests ?? listManifests(root, adapters), cache: new Map() }
            : previous;

        const current = loadStoredFiles(db, repoId);
        const fileSet = new Set(current.keys());
        const resolvers = createResolvers(adapters, {
            root, fileSet, manifests: resolution.manifests, readText: repoTextReader(root), cache: resolution.cache,
        }, current);
        const adapterOf = (p: string): LanguageAdapter | null => adapterFor(p, adapters);

        // The declares rule (ADR-065): a changed file whose declares moved can change what any file of its language
        // resolves to (a Go function moved to another file of its package), so all of that language's files re-resolve.
        const redeclared = new Set<LanguageAdapter>();
        for (const record of written){
            const before = stored.get(record.path)?.declares;
            const adapter = adapterOf(record.path);
            if (before !== undefined && adapter !== null && !sameList(before, record.declares)) redeclared.add(adapter);
        }

        // the imports as they are now against as they were: every file's when the file set or a resolution input changed,
        // else the changed files' own and those of every language whose declares moved (a file that failed keeps its
        // old row and old edges, ADR-022)
        const sources = resolvedAll ? [...current.keys()] : [...new Set([
            ...changed,
            ...(redeclared.size === 0 ? [] : [...current.keys()].filter((p) => { const a = adapterOf(p); return a !== null && redeclared.has(a); })),
        ])];
        const before = resolvedAll ? loadImportEdges(db, repoId) : loadImportEdgesFrom(db, repoId, sources);
        const after = sources.flatMap((source) => {
            const resolver = resolvers.get(adapterOf(source)?.id ?? "");
            return resolver === undefined ? [] : edgesOf(resolver, source, current.get(source)!.importSpecifiers);
        });
        const { removed, added } = diffEdges(before, after);

        applyEdgeChanges(db, repoId, removed, added, levelEdgeDeltas([...removed, ...cascaded], added));
        // a package.json can change only its entry points, and a moved declare can name a new one: either is a change readers must see
        const entriesChanged = (resolvedAll || redeclared.size > 0) && replaceEntryPoints(db, repoId, entryPointsOf(resolvers));
        if (fileSetChanged){
            syncFolders(db, repoId, buildFolders([...current.keys()], path.basename(root)));
            pruneSummaries(db, repoId);   // a deleted file, or a folder left empty, takes its summary with it
        }

        const anything = changed.length > 0 || deleted.length > 0 || removed.length > 0 || added.length > 0 || entriesChanged;
        if (anything){
            markIndexed(db, repoId, readGitHead(root));
            const note = structureNote(errors, scanned);
            writeStage(db, repoId, "structure", {
                state: "ready",
                done: current.size,
                total: current.size,
                ...(note === null ? {} : { note }),
            });
        }

        return {
            repoId,
            changed,
            deleted,
            unchanged,
            errors,
            scanned,
            resolvedAll,
            edgesAdded: added.length,
            edgesRemoved: removed.length + cascaded.length,
            totalMs: performance.now() - started,
            indexVersion: anything ? bumpIndexVersion(db, repoId) : readIndexVersion(db, repoId),
            resolution,
        };
    } finally{
        releaseIndexLock(db);
    }
}

/** Two sorted lists hold the same strings. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}


/**
 * The paths to look at. A path the index doesn't hold may be a whole folder that was deleted or renamed (a watcher's
 * unlinkDir), so every indexed file under it is looked at too.
 */
function expandFolders(changedPaths: readonly string[], stored: ReadonlyMap<string, unknown>): string[] {
    const paths = new Set(changedPaths.map(normalizeSlashes));
    for (const rel of [...paths]){
        if (stored.has(rel)) continue;
        const prefix = `${rel}/`;
        for (const filePath of stored.keys()) if (filePath.startsWith(prefix)) paths.add(filePath);
    }
    return [...paths].sort();
}

/** The size of a regular file, or null when there's no file there (deleted, or a folder). */
function fileSize(absolute: string): number | null {
    try{
        const stat = fs.statSync(absolute);
        return stat.isFile() ? stat.size : null;
    } catch{
        return null;
    }
}

/** Import rows to delete and to insert. The specifier is part of the key, so a rewritten specifier replaces its row. */
function diffEdges(before: readonly ImportEdge[], after: readonly ImportEdge[]): { removed: ImportEdge[]; added: ImportEdge[] } {
    const key = (e: ImportEdge): string => `${e.source}\0${e.target}\0${e.specifier}`;
    const beforeKeys = new Set(before.map(key));
    const afterKeys = new Set(after.map(key));
    return {
        removed: before.filter((e) => !afterKeys.has(key(e))),
        added: after.filter((e) => !beforeKeys.has(key(e))),
    };
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
