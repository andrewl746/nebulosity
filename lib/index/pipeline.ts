import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getDb, type Db } from "../db/client";
import { acquireIndexLock, releaseIndexLock } from "../db/store/lock";
import { writeStage } from "../db/store/stages";
import {
    deleteFilesNotIn, loadStoredFiles, markIndexed, replaceAggregates, replaceImports, upsertRepository, writeFileRecords,
    type FileError, type FileRecord, type ImportEdge,
} from "../db/store/structure";
import { pruneSummaries } from "../db/store/summaries";
import { buildFolders, buildLevelEdges } from "./aggregate";
import { discoverFiles, isTestPath, readGitHead, type SkippedFile } from "./discover";
import { splitIdentifier } from "./identifiers";
import { languageOf, TYPESCRIPT_EXTENSIONS, parseTypeScriptFile } from "./languages/typescript";
import { repoKey } from "./paths";
import { createResolver } from "./resolve";

export type IndexStage = "discover" | "parse" | "write" | "resolve" | "aggregate";

export type IndexOptions = {
    /** Called at least once per stage, in order. done/total count files (folders for "aggregate"). */
    onProgress?: (stage: IndexStage, done: number, total: number) => void;
    /** Files parsed and committed per transaction. */
    batchSize?: number;
    maxFileBytes?: number;
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
    skipped: SkippedFile[];
    timingsMs: Record<IndexStage, number>;
    totalMs: number;
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

    acquireIndexLock(db);
    let stageRepoId: number | null = null;   // set once the repo row exists, so a failure can be reported on it

    try{
        const repoId = upsertRepository(db, repoKey(root));
        stageRepoId = repoId;
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: 0, note: "discovering files" });

        // ---- discover ---------------------------------------------------------
        let t = performance.now();
        const discovered = discoverFiles(root, { extensions: TYPESCRIPT_EXTENSIONS, maxBytes: options.maxFileBytes });
        const stored = loadStoredFiles(db, repoId);
        timingsMs.discover = performance.now() - t;
        options.onProgress?.("discover", discovered.files.length, discovered.files.length);
        writeStage(db, repoId, "structure", { state: "running", done: 0, total: discovered.files.length });

        // ---- parse + write, one batch of files at a time (bounded memory) ------
        const errors: FileError[] = [];
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

                // ADR-022: the hash means "the indexer last processed exactly these bytes"
                if (stored.get(file.path)?.contentHash === contentHash){
                    unchanged++;
                    continue;
                }

                try{
                    const parsed = parseTypeScriptFile(file.path, text);
                    records.push({
                        path: file.path,
                        kind: /\.(tsx|jsx)$/.test(file.path) ? "component" : "module",
                        contentHash,
                        language: languageOf(file.path),
                        sizeBytes: file.sizeBytes,
                        lineCount: parsed.lineCount,
                        isTest: isTestPath(file.path),
                        importSpecifiers: parsed.imports,
                        chunks: parsed.chunks.map((c) => ({ ...c, nameSplit: splitIdentifier(c.name) })),
                        symbols: parsed.symbols,
                    });
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
        const resolve = createResolver(root, fileSet);
        const edges: ImportEdge[] = [];

        for (const [source, file] of current){
            const targets = new Set<string>();
            for (const specifier of file.importSpecifiers){
                const target = resolve(source, specifier);
                if (target === null || targets.has(target)) continue;   // one edge per file pair
                targets.add(target);
                edges.push({ source, target, specifier });
            }
        }

        const edgeCount = replaceImports(db, repoId, edges);
        timingsMs.resolve = performance.now() - t;
        options.onProgress?.("resolve", fileSet.size, fileSet.size);

        // ---- aggregate ------------------------------------------------------------
        t = performance.now();
        const folderRows = buildFolders([...fileSet], path.basename(root));
        const levelRows = buildLevelEdges(edges);
        replaceAggregates(db, repoId, folderRows, levelRows);
        pruneSummaries(db, repoId);   // a deleted file or folder takes its summary with it
        timingsMs.aggregate = performance.now() - t;
        options.onProgress?.("aggregate", folderRows.length, folderRows.length);

        const indexedHead = readGitHead(root);
        markIndexed(db, repoId, indexedHead);
        writeStage(db, repoId, "structure", {
            state: "ready",
            done: fileSet.size,
            total: fileSet.size,
            ...(errors.length > 0 ? { note: `${errors.length} files failed to index` } : {}),
        });

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
            skipped: discovered.skipped,
            timingsMs,
            totalMs: performance.now() - started,
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

function isDirectory(p: string): boolean {
    try{
        return fs.statSync(p).isDirectory();
    } catch{
        return false;   // missing, or unreachable through a file (ENOTDIR)
    }
}
