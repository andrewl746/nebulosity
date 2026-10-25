import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { IndexStage } from "../contracts";
import { getDb, type Db } from "../db/client";
import { replaceEntryPoints } from "../db/store/entries";
import { acquireIndexLock, releaseIndexLock } from "../db/store/lock";
import { deferCodeSearch, fillCodeSearch, isCodeSearchDeferred } from "../db/store/search";
import { writeStage } from "../db/store/stages";
import {
    deleteFilesNotIn, loadStoredFiles, markIndexed, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileError, type FileRecord, type ImportEdge,
} from "../db/store/structure";
import { replaceDocs } from "../db/store/docs";
import { pruneSummaries } from "../db/store/summaries";
import { bumpIndexVersion, readAdapterVersion, recordAdapterVersion } from "../db/store/version";
import { buildFolders, buildLevelEdges } from "./aggregate";
import { docLinks, folderSuffixes, type KnownPaths } from "./docs";
import { discoverFiles, isTestPath, readGitHead, type DiscoveredFile, type SkippedFile } from "./discover";
import { splitIdentifier } from "./identifiers";
import type { LanguageAdapter, ParsedFile, Reading } from "./languages/adapter";
import { ADAPTERS, adapterFor } from "./languages/registry";
import { createResolvers, edgesOf, entryPointsOf } from "./languages/resolution";
import { GrammarNotLoadedError, isPrepared } from "./languages/treesitter";
import { repoKey } from "./paths";

export type { IndexStage };

export type IndexOptions = {
    /** Called at least once per stage, in order. done/total count files (folders for "aggregate"). */
    onProgress?: (stage: IndexStage, done: number, total: number) => void;
    /** Files parsed and committed per transaction. */
    batchSize?: number;
    /**
     * A code file over this is indexed for its imports only (ADR-053). Default DEFAULT_MAX_FILE_BYTES (1 MB): the product
     * never passes another, so the summary planner and describe, which read that constant, agree with the index.
     */
    maxFileBytes?: number;
    /** Up to this, such a file is parsed in full for them; past it, token-scanned. Default DEFAULT_PARSE_MAX_FILE_BYTES (5 MB). */
    parseMaxFileBytes?: number;
    /** A code file over this is skipped. Default DEFAULT_HARD_MAX_FILE_BYTES (20 MB). */
    hardMaxFileBytes?: number;
    /**
     * At least this many files to parse (new, or with no stored hash) and code search is filled in one go after the
     * structure stage instead of by a trigger per chunk (ADR-031, amended). Default 2,000.
     */
    bulkSearchThreshold?: number;
    /** The language adapters, in the registry's order. Default ADAPTERS; tests pass their own (a toy language), as they shrink maxFileBytes. */
    adapters?: readonly LanguageAdapter[];
};

export type IndexResult = {
    repoId: number;
    /** Files in the index after this run. */
    files: number;
    changed: number;
    unchanged: number;
    deleted: string[];
    edges: number;
    folders: number;
    levelEdges: number;
    errors: FileError[];
    /**
     * Files whose adapter's parse threw, each with the error, read by the scan instead (the E4 final review's B-I1): in the
     * index with their imports, as a file over the cap is, but with no declarations or code search. Not in `errors`, which
     * lists files left out.
     */
    scanned: FileError[];
    /** Files left out: over the hard bound, unreadable, or a doc over the cap. */
    skipped: SkippedFile[];
    /** Code files over the size cap, in the index for their imports only: no declarations, code search or summary (ADR-053). */
    importsOnly: DiscoveredFile[];
    timingsMs: Record<IndexStage, number>;
    totalMs: number;
    /** Filling code search after a bulk run (0 when it wasn't deferred); not part of totalMs (S1). */
    searchIndexMs: number;
    usedGit: boolean;
    indexedHead: string | null;
};

/** Thrown when the path to index isn't an existing directory (a typo, or a file). */
export class RepoNotFoundError extends Error {
    constructor(root: string){
        super(`No directory at ${root}`);
        this.name = "RepoNotFoundError";
    }
}

/**
 * The structure stage (PIVOT_SPEC.md §5.2): discover → parse changed files → write →
 * resolve every import → aggregate. When it returns, the Map has everything it needs.
 * Synchronous on purpose: better-sqlite3 and the TS parser are both synchronous, and
 * the Next server will run this on a worker thread (V1.3).
 */
export function indexRepository(repoRoot: string, options: IndexOptions = {}): IndexResult {
    const root = path.resolve(repoRoot);

    // Checked before anything touches the database: a mistyped path must fail loudly,
    // not "index" zero files, leave a repositories row for a path that never existed,
    // and become the active repo. An existing but empty folder is still fine.
    if (!isDirectory(root)){
        throw new RepoNotFoundError(root);
    }

    const db = getDb();
    const started = performance.now();
    const timingsMs: Record<IndexStage, number> = { discover: 0, parse: 0, write: 0, resolve: 0, aggregate: 0 };
    const batchSize = options.batchSize ?? 500;
    const adapters = options.adapters ?? ADAPTERS;

    acquireIndexLock(db);
    let stageRepoId: number | null = null;   // set once the repo row exists, so a failure can be reported on it

    try{
        // a bulk run that died before filling code search left it deferred: repair that before anything else
        if (isCodeSearchDeferred(db)) fillCodeSearch(db);

        const repoId = upsertRepository(db, repoKey(root));
        stageRepoId = repoId;
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: 0, note: "discovering files" });

        // ---- discover ---------------------------------------------------------
        let t = performance.now();
        const discovered = discoverFiles(root, {
            rules: adapters,
            maxBytes: options.maxFileBytes, parseMaxBytes: options.parseMaxFileBytes, hardMaxBytes: options.hardMaxFileBytes,
        });
        const stored = loadStoredFiles(db, repoId);
        timingsMs.discover = performance.now() - t;
        options.onProgress?.("discover", discovered.files.length, discovered.files.length);
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: discovered.files.length });

        // every discovered file is claimed by exactly one adapter: discovery listed only their extensions
        const adapterOf = new Map(discovered.files.map((f) => [f.path, adapterFor(f.path, adapters)!]));
        assertGrammarsLoaded(new Set(adapterOf.values()));

        // files an older version of their adapter parsed are parsed again whatever their hash: what it stored may lack
        // what this one reads. Each adapter has its own version (ADR-065), so bumping one language re-parses only its files.
        const reparse = new Set(adapters.filter((a) => readAdapterVersion(db, repoId, a.id) !== a.version));
        const reparsed = (filePath: string): boolean => reparse.has(adapterOf.get(filePath)!);
        const toParse = discovered.files.filter((f) => reparsed(f.path) || (stored.get(f.path)?.contentHash ?? "") === "").length;
        const deferred = toParse >= (options.bulkSearchThreshold ?? 2_000);
        if (deferred) deferCodeSearch(db);

        // ---- parse + write, one batch of files at a time (bounded memory) ------
        const errors: FileError[] = [];
        const scanned: FileError[] = [];
        const skipped: SkippedFile[] = [...discovered.skipped];   // the docs read below add theirs
        let changed = 0;
        let unchanged = 0;

        for (let i = 0; i < discovered.files.length; i += batchSize){
            const processed = Math.min(i + batchSize, discovered.files.length);
            const slice = discovered.files.slice(i, i + batchSize);
            const records: FileRecord[] = [];

            t = performance.now();
            for (const file of slice){
                let text: string;
                try{
                    text = fs.readFileSync(path.join(root, file.path), "utf8");
                } catch (err){
                    errors.push({ path: file.path, error: message(err) });
                    continue;
                }

                const contentHash = createHash("sha256").update(text).digest("hex");

                // ADR-022: the hash means "the indexer last processed exactly these bytes" (with this adapter, ADR-053)
                if (!reparsed(file.path) && stored.get(file.path)?.contentHash === contentHash){
                    unchanged++;
                    continue;
                }

                try{
                    records.push(toFileRecord(file.path, text, contentHash, file.sizeBytes, {
                        importsOnly: file.importsOnly, adapters, onScanned: (error) => scanned.push({ path: file.path, error }),
                    }));
                } catch (err){
                    errors.push({ path: file.path, error: message(err) });
                }
            }
            timingsMs.parse += performance.now() - t;
            options.onProgress?.("parse", processed, discovered.files.length);

            t = performance.now();
            const writeErrors = writeFileRecords(db, repoId, records);
            errors.push(...writeErrors);
            changed += records.length - writeErrors.length;
            timingsMs.write += performance.now() - t;
            options.onProgress?.("write", processed, discovered.files.length);
            writeStage(db, repoId, "structure", { state: "running", done: processed, total: discovered.files.length });
        }

        // ---- resolve: the database is the source of truth from here on ---------
        // (a file that failed this run keeps its previous row and specifiers)
        t = performance.now();
        const deleted = deleteFilesNotIn(db, repoId, new Set(discovered.files.map((f) => f.path)));
        const current = loadStoredFiles(db, repoId);
        const fileSet = new Set(current.keys());
        // one resolver per language for the run, each over its own files' stored facts (ADR-065)
        const resolvers = createResolvers(adapters, { root, fileSet, manifests: discovered.manifests, readText: repoTextReader(root), cache: new Map() }, current);
        const edges: ImportEdge[] = [];

        for (const [source, file] of current){
            const resolver = resolvers.get(adapterFor(source, adapters)?.id ?? "");
            if (resolver !== undefined) edges.push(...edgesOf(resolver, source, file.importSpecifiers));
        }

        const edgeCount = replaceImports(db, repoId, edges);
        replaceEntryPoints(db, repoId, entryPointsOf(resolvers));
        timingsMs.resolve = performance.now() - t;
        options.onProgress?.("resolve", fileSet.size, fileSet.size);

        // ---- aggregate ------------------------------------------------------------
        t = performance.now();
        const folderRows = buildFolders([...fileSet], path.basename(root));
        const levelRows = buildLevelEdges(edges);
        replaceAggregates(db, repoId, folderRows, levelRows);
        pruneSummaries(db, repoId);   // a deleted file or folder takes its summary with it

        // which docs talk about which folders (ADR-054): read with the folders just built, so a mention can name any of them
        const folderPaths = folderRows.map((f) => f.path);
        const known: KnownPaths = { folders: new Set(folderPaths), files: fileSet, suffixes: folderSuffixes(folderPaths) };
        const readDocs = discovered.docs.flatMap((doc) => {
            try{
                return [docLinks(doc.path, fs.readFileSync(path.join(root, doc.path), "utf8"), known)];
            } catch (err){
                skipped.push({ path: doc.path, reason: `unreadable: ${message(err)}` });   // reported, as an unreadable source file is
                return [];
            }
        });
        replaceDocs(db, repoId, readDocs.map((d) => d.facts), readDocs.flatMap((d) => d.links));
        timingsMs.aggregate = performance.now() - t;
        options.onProgress?.("aggregate", folderRows.length, folderRows.length);

        const indexedHead = readGitHead(root);
        markIndexed(db, repoId, indexedHead);
        // A file that failed keeps its previous row (ADR-022). After a forced re-parse that row is the older adapter's, and
        // its hash still matches the bytes, so it would stay as it is for good. Its hash is cleared as this version is
        // recorded, so the next full run parses that file again, and no other. Each adapter records its own version.
        for (const adapter of adapters){
            const unparsed = reparse.has(adapter)
                ? errors.map((e) => e.path).filter((p) => stored.has(p) && adapterOf.get(p) === adapter)
                : [];
            recordAdapterVersion(db, repoId, adapter.version, unparsed, adapter.id);
        }
        const note = structureNote(errors, scanned);
        writeStage(db, repoId, "structure", {
            state: "ready",
            done: fileSet.size,
            total: fileSet.size,
            ...(note === null ? {} : { note }),
        });
        bumpIndexVersion(db, repoId);   // the Map refetches what it shows (ADR-036)

        const totalMs = performance.now() - started;   // S1 is the structure stage: everything above
        const searchStarted = performance.now();
        if (deferred) fillCodeSearch(db);
        const searchIndexMs = deferred ? performance.now() - searchStarted : 0;

        return {
            repoId,
            files: fileSet.size,
            changed,
            unchanged,
            deleted,
            edges: edgeCount,
            folders: folderRows.length,
            levelEdges: levelRows.length,
            errors,
            scanned,
            skipped,
            importsOnly: discovered.files.filter((f) => f.importsOnly),
            timingsMs,
            totalMs,
            searchIndexMs,
            usedGit: discovered.usedGit,
            indexedHead,
        };
    } catch (err){
        if (stageRepoId !== null) reportStructureFailure(db, stageRepoId, err);
        throw err;
    } finally{
        releaseIndexLock(db);
    }
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function reportStructureFailure(db: Db, repoId: number, err: unknown): void {
    try{
        writeStage(db, repoId, "structure", { state: "failed", done: 0, total: 0, note: message(err) });
    } catch{
        // the database itself may be what failed; the original error matters more
    }
}

/**
 * The guard (ADR-065): a run that meets a file whose grammar this process hasn't loaded stops, naming the grammars,
 * rather than index nothing for them. prepareLanguages() loads every grammar; a test adapter without one never trips it.
 */
export function assertGrammarsLoaded(needed: Iterable<LanguageAdapter>): void {
    const missing = [...needed].filter((a) => a.grammar !== null && !isPrepared(a.id)).map((a) => a.id);
    if (missing.length > 0) throw new GrammarNotLoadedError(missing);
}

/** A repo file's text for a resolver (a manifest), or null when it can't be read. */
export function repoTextReader(root: string): (rel: string) => string | null {
    return (rel) => {
        try{
            return fs.readFileSync(path.join(root, rel), "utf8");
        } catch{
            return null;
        }
    };
}

function isDirectory(p: string): boolean {
    try{
        return fs.statSync(p).isDirectory();
    } catch{
        return false;   // missing, or unreachable through a file (ENOTDIR)
    }
}

/**
 * One file's row as the structure store writes it, from its bytes (PIVOT_SPEC.md §5.2). Throws if the file can't be parsed.
 * A file over the size cap is read for its imports only, parsed or token-scanned by size: no declarations and no chunks,
 * so no code search (ADR-053). The adapter claiming the path parses it (ADR-065); a path no adapter claims throws. A
 * parse that throws is tried again as a scan (parseOrScan), and `onScanned` hears why.
 */
export function toFileRecord(
    filePath: string, text: string, contentHash: string, sizeBytes: number,
    opts: { importsOnly?: "parse" | "scan"; adapters?: readonly LanguageAdapter[]; onScanned?: (error: string) => void } = {}
): FileRecord {
    const adapters = opts.adapters ?? ADAPTERS;
    const adapter = adapterFor(filePath, adapters);
    if (adapter === null) throw new Error(`No language adapter claims ${filePath}`);
    const parsed = parseOrScan(adapter, filePath, text, opts.importsOnly ?? "full", opts.onScanned);
    return {
        path: filePath,
        kind: adapter.id === "typescript" && /\.(tsx|jsx)$/.test(filePath) ? "component" : "module",
        contentHash,
        language: adapter.languageOf(filePath),
        sizeBytes,
        lineCount: parsed.lineCount,
        isTest: isTestPath(filePath, adapters),
        importSpecifiers: parsed.imports,
        declares: parsed.declares,
        chunks: parsed.chunks.map((c) => ({ ...c, nameSplit: splitIdentifier(c.name) })),
        symbols: parsed.symbols,
        calls: parsed.calls,
    };
}

/**
 * An adapter's parse, or, when the parse throws, its scan (the E4 final review's B-I1). A recursive walk can overflow
 * the stack on a deep but valid file (a long `else if` chain, a generated concatenation of thousands of terms), and the
 * seam promises a parse throws only for a file it can't read at all. Without this the file got no row, so it vanished
 * from the Map and the tools. The scan reads the imports without a tree, as for a file over the cap: the file keeps its
 * row and its edges, with no declarations or code search. A missing grammar is the guard's to report, never retried;
 * a scan's own error, or a scan that throws in turn, still drops the file into the run's errors. It applies to every
 * adapter, TypeScript's too. A fallback is never silent: it is logged here, once, with the adapter and the error, and the
 * run's `scanned` list reaches the stage note, the CLI, the worker's answer and the language bench (which fails L2 on it).
 */
function parseOrScan(adapter: LanguageAdapter, filePath: string, text: string, reading: Reading, onScanned?: (error: string) => void): ParsedFile {
    try{
        return adapter.parse(filePath, text, reading);
    } catch (err){
        if (reading === "scan" || err instanceof GrammarNotLoadedError) throw err;
        const scanned = adapter.parse(filePath, text, "scan");
        console.warn(`[index] the ${adapter.id} parse of ${filePath} failed (${message(err)}), so the scan read its imports only`);
        onScanned?.(message(err));
        return scanned;
    }
}

/** How many files to name in a note about the scanned ones before counting the rest. */
const SCANNED_SHOWN = 3;

/**
 * The files the scan read after their parse failed, counted with the first few paths:
 * "2 files read by the scan (their parse failed): a.toy, b.toy". The stage note, the CLI and the bench say it so.
 */
export function describeScanned(scanned: readonly FileError[]): string {
    const named = scanned.slice(0, SCANNED_SHOWN).map((s) => s.path).join(", ");
    const rest = scanned.length > SCANNED_SHOWN ? `, and ${scanned.length - SCANNED_SHOWN} more` : "";
    return `${scanned.length} ${scanned.length === 1 ? "file" : "files"} read by the scan (their parse failed): ${named}${rest}`;
}

/**
 * The structure stage's note: the files that failed to index, and the files the scan read instead of a parse, or null
 * when there are none. The full run and the incremental update both write it.
 */
export function structureNote(errors: readonly FileError[], scanned: readonly FileError[]): string | null {
    const parts = [
        ...(errors.length > 0 ? [`${errors.length} files failed to index`] : []),
        ...(scanned.length > 0 ? [describeScanned(scanned)] : []),
    ];
    return parts.length === 0 ? null : parts.join("; ");
}
