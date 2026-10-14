import fs from "fs";
import os from "os";
import path from "path";
import {
    DEMO_FORMAT_VERSION, type DemoDescribeBundle, type DemoManifest, type DemoPageIndex, type DemoSearchIndex, type LevelResponse,
} from "../contracts";
import { getDb } from "../db/client";
import { loadExportedNames } from "../db/store/search";
import { loadIndexedHead, requireRepository } from "../db/store/structure";
import { loadFileFacts, loadFolderFacts, loadSummaries } from "../db/store/summaries";
import { readIndexVersion } from "../db/store/version";
import { describe } from "../engine/describe";
import { readRepoRemote } from "../engine/git-remote";
import { level } from "../engine/level";
import { readIndexStatus } from "../engine/status";
import { nebulosityHome } from "../home";
import { dirOf, repoKey } from "../index/paths";
import { leakNeedles, scanForLeaks, type Leak } from "./privacy";

export type DemoExportOptions = {
    /** The name the demo shows for the repo, in place of its root; its folder's name by default. */
    publicName?: string;
    now?: Date;
    /** Also scanned for, with the folders (the CLI passes git's user.email). */
    email?: string | null;
};
export type DemoExportReport = {
    folders: number; levelFiles: number; bundles: number; pageIndexes: number;
    files: number; bytes: number; indexVersion: number; leaks: Leak[];
};

/** The output folder holds something that isn't an earlier export, so it's left alone. */
export class ExportRefusedError extends Error {
    constructor(dir: string){
        super(`${dir} isn't empty and isn't an earlier demo export (no manifest.json), so nothing was written. Pick an empty folder.`);
        this.name = "ExportRefusedError";
    }
}

/** The index moved while the export read it (the Map's worker wrote), so the files may disagree with each other. */
export class IndexChangedError extends Error {
    constructor(){
        super("The index changed during the export (the Map's background worker wrote). Run the export again.");
        this.name = "IndexChangedError";
    }
}

/** Written first and removed last, so an export that died half-way is recognised and replaced next time. */
const IN_PROGRESS = "EXPORTING";

/** Empties an earlier export (or an interrupted one); refuses anything else. */
function prepare(outDir: string): void {
    if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0){
        const earlier = fs.existsSync(path.join(outDir, "manifest.json")) || fs.existsSync(path.join(outDir, IN_PROGRESS));
        if (!earlier) throw new ExportRefusedError(outDir);
        fs.rmSync(outDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, IN_PROGRESS), "");
}

/** A page's own boxes (portals stand for other pages, so they're left out). */
const boxesOf = (page: LevelResponse): string[] => page.nodes.filter((n) => n.kind !== "portal").map((n) => n.path);

/**
 * Writes the static demo of an indexed repo (ADR-049, API_CONTRACTS.md §18): every page of every folder's level, every
 * describe answer bundled per folder, a page index per paged folder, a search index and a manifest. Every answer names
 * the repo by its public name instead of its absolute root, and the finished folder is scanned for any spelling of
 * the repo's root, the Nebulosity folder or the home folder (and the email, when given). Read only on the database.
 */
export function exportDemo(repoRoot: string, outDir: string, options: DemoExportOptions = {}): DemoExportReport {
    const root = path.resolve(repoRoot);
    const db = getDb();
    const repoId = requireRepository(db, repoKey(root));
    const status = readIndexStatus(root);
    if (status === null) throw new Error(`${root} has no index status; run npm run index -- ${root} first.`);
    const version = readIndexVersion(db, repoId);
    const publicName = options.publicName ?? path.basename(root);
    const summariesOff = status.stages.summaries.state === "off";
    prepare(outDir);

    let files = 0;
    let bytes = 0;
    const write = (rel: string, value: unknown): void => {
        const file = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const text = JSON.stringify(value);
        fs.writeFileSync(file, text);
        files++;
        bytes += Buffer.byteLength(text);
    };
    const named = <T extends { repo: string }>(answer: T): T => ({ ...answer, repo: publicName });

    // levels, page by page; a paged folder also gets the index of its pages' boxes
    const folders = loadFolderFacts(db, repoId);
    const paths = folders.map((f) => f.path);
    const pages: Record<string, number> = {};
    let levelFiles = 0;
    let pageIndexes = 0;
    paths.forEach((folder, id) => {
        const first = level(root, folder, { summariesOff });
        write(`level/${id}-0.json`, named(first));
        levelFiles++;
        if (first.pageCount <= 1) return;
        pages[String(id)] = first.pageCount;
        const boxes = [boxesOf(first)];
        for (let page = 1; page < first.pageCount; page++){
            const next = level(root, folder, { summariesOff, page });
            write(`level/${id}-${page}.json`, named(next));
            levelFiles++;
            boxes.push(boxesOf(next));
        }
        write(`pages/${id}.json`, { boxes } satisfies DemoPageIndex);
        pageIndexes++;
    });

    // describe answers, one bundle per folder: the folder's own, then each file directly inside it, in path order
    const ids = new Map(paths.map((p, i) => [p, i]));
    const facts = loadFileFacts(db, repoId);
    const bundles: DemoDescribeBundle[] = paths.map((folder) => ({ [folder]: named(describe(root, folder, { summariesOff })) }));
    for (const file of facts) bundles[ids.get(dirOf(file.path))!][file.path] = named(describe(root, file.path, { summariesOff }));
    bundles.forEach((bundle, id) => write(`describe/${id}.json`, bundle));

    // what the demo's search ranks (staticSearch.ts)
    const position = new Map(facts.map((f, i) => [f.path, i]));
    write("search.json", {
        summaries: loadSummaries(db, repoId)
            .filter((s) => s.kind !== "repo" && s.tagline)
            .map((s): [number, string, string, string] => [s.kind === "folder" ? 1 : 0, s.path, s.tagline!, s.summary ?? ""]),
        folders: folders.filter((f) => f.path !== "").map((f): [string, number] => [f.path, f.fileCount]),
        files: facts.map((f): [string, number, number] => [f.path, f.importedBy, f.isTest ? 1 : 0]),
        declarations: loadExportedNames(db, repoId).map((d): [string, number] => [d.name, position.get(d.path)!]),
    } satisfies DemoSearchIndex);

    // the indexed repo's license travels with data derived from its code
    const license = ["LICENSE.txt", "LICENSE", "LICENSE.md"].map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
    if (license){
        fs.copyFileSync(license, path.join(outDir, "SOURCE-LICENSE.txt"));
        files++;
        bytes += fs.statSync(license).size;
    }

    if (readIndexVersion(db, repoId) !== version) throw new IndexChangedError();
    const remote = readRepoRemote(root);
    write("manifest.json", {
        format: DEMO_FORMAT_VERSION,
        repo: publicName,
        ...(remote ? { remote } : {}),
        commit: loadIndexedHead(db, repoId),
        exportedAt: (options.now ?? new Date()).toISOString(),
        status: { ...status, repo: publicName },
        folders: paths,
        pages,
    } satisfies DemoManifest);
    fs.rmSync(path.join(outDir, IN_PROGRESS));

    const leaks = scanForLeaks(outDir, leakNeedles({ folders: [root, nebulosityHome(), os.homedir()], email: options.email }));
    return { folders: paths.length, levelFiles, bundles: bundles.length, pageIndexes, files, bytes, indexVersion: version, leaks };
}
