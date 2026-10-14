import { createHash } from "crypto";
import type { StoredSummaryStatus, SummaryTargetKind } from "../../db/schema";
import { targetKey, type FileFacts, type FolderFacts, type StoredSummary, type SummaryText } from "../../db/store/summaries";
import { dirOf } from "../paths";
import { PROMPT_VERSION, renderFolderPrompt, renderRepoPrompt, testFileSummary, testFolderSummary, type FolderItem } from "./prompts";

/**
 * current: the text matches the current input · template: a test file or test-only folder whose
 * template is missing or out of date, written right away · ready: needs a model and can go now ·
 * waiting: needs a model, but a child isn't done yet · lazy: an out-of-date folder left
 * for later (redone when someone opens it) · in-flight: a batch already carries it ·
 * failed: failed earlier in this run; the next run retries it
 */
export type TargetState = "current" | "template" | "ready" | "waiting" | "lazy" | "in-flight" | "failed";

export type PlannedTarget = {
    kind: SummaryTargetKind;
    path: string;
    /** The model that would write it, or "template". */
    model: string;
    inputHash: string;
    state: TargetState;
    /** The row's status from now on; null leaves it as it is. */
    status: StoredSummaryStatus | null;
    templateText?: SummaryText;
    /** Folders and the repo. A file's prompt is built from disk when it's sent. */
    prompt?: string;
};

export type PlanOptions = {
    models: { readonly file: string; readonly folder: string; readonly repo: string };
    /** true redoes out-of-date folders now (a full run); false leaves them lazy until opened (incremental runs). */
    refreshStaleFolders: boolean;
    /** targetKeys that failed earlier in this run: they wait for the next run. */
    failedThisRun: ReadonlySet<string>;
};

/** hash(model, prompt version, input) (PIVOT_SPEC.md §5.3): identical input is never summarized twice. */
export function inputHash(model: string, promptVersion: number, input: string): string {
    return createHash("sha256").update(`${model}\n${promptVersion}\n${input}`).digest("hex");
}

/** A child in one of these states won't change again this wave, so its folder can be summarized. */
const SETTLED: ReadonlySet<TargetState> = new Set(["current", "template", "lazy", "failed"]);

/**
 * Decides, for every file, folder and the repo, whether its summary is current and, if
 * not, whether it can be (re)written now. Pure: same facts in, same plan out. The result
 * is in queue order: central files first (most-imported), then folders bottom-up, the
 * repo last.
 */
export function planSummaries(
    files: readonly FileFacts[],
    folders: readonly FolderFacts[],
    stored: readonly StoredSummary[],
    options: PlanOptions
): PlannedTarget[] {
    const storedByKey = new Map(stored.map((s) => [targetKey(s.kind, s.path), s]));
    const planned = new Map<string, PlannedTarget>();

    // the text a target shows right now: its fresh template, else whatever its row holds
    const textOf = (target: PlannedTarget): SummaryText | null => {
        if (target.templateText) return target.templateText;
        const row = storedByKey.get(targetKey(target.kind, target.path));
        return row?.tagline && row.summary !== null ? { tagline: row.tagline, summary: row.summary } : null;
    };

    // ---- files: independent of each other ---------------------------------------------
    for (const file of files){
        const key = targetKey("file", file.path);
        const row = storedByKey.get(key);

        if (file.isTest){
            const text = testFileSummary(file.path, file.lineCount);
            const hash = inputHash("template", PROMPT_VERSION, `${file.path}\n${text.tagline}\n${text.summary}`);
            const current = row?.inputHash === hash;
            planned.set(key, current
                ? { kind: "file", path: file.path, model: "template", inputHash: hash, state: "current", status: row.status === "skipped" ? null : "skipped" }
                : { kind: "file", path: file.path, model: "template", inputHash: hash, state: "template", status: "skipped", templateText: text });
            continue;
        }

        // A file's prompt is built from its bytes, so its content hash stands in for the prompt
        // here: same bytes, same prompt. Planning then never has to read source files.
        const hash = inputHash(options.models.file, PROMPT_VERSION, `file\n${file.path}\n${file.contentHash}`);
        planned.set(key, decide("file", file.path, options.models.file, hash, row, true, options));
    }

    // ---- folders, deepest first, so every child is planned before its parent ------------
    const filesIn = new Map<string, FileFacts[]>();
    for (const file of files) push(filesIn, dirOf(file.path), file);

    const foldersIn = new Map<string, FolderFacts[]>();
    for (const folder of folders) if (folder.parentPath !== null) push(foldersIn, folder.parentPath, folder);

    // a folder's size, for ordering its parent's list: the lines of every file under it
    const linesBelow = new Map<string, number>();
    for (const file of files){
        for (let dir: string | null = dirOf(file.path); dir !== null; dir = dir === "" ? null : dirOf(dir)){
            linesBelow.set(dir, (linesBelow.get(dir) ?? 0) + file.lineCount);
        }
    }

    // what each folder's subtree holds, for spotting test-only folders (no model, like a test file)
    const testFilesBelow = new Map<string, number>();
    const nonTestFilesBelow = new Map<string, number>();
    for (const file of files){
        const tally = file.isTest ? testFilesBelow : nonTestFilesBelow;
        for (let dir: string | null = dirOf(file.path); dir !== null; dir = dir === "" ? null : dirOf(dir)){
            tally.set(dir, (tally.get(dir) ?? 0) + 1);
        }
    }

    // the root folder's row carries the repo's name (aggregate.ts), which a top-level test folder's template uses
    const repoName = folders.find((f) => f.path === "")?.name ?? "";

    for (const folder of [...folders].sort((a, b) => b.depth - a.depth || compare(a.path, b.path))){
        const kind: SummaryTargetKind = folder.path === "" ? "repo" : "folder";

        // At least one file and no non-test file anywhere below: planned exactly like a test file, and
        // settled at once, so its parent never waits on it. The repo always gets a real summary.
        const testCount = testFilesBelow.get(folder.path) ?? 0;
        if (kind === "folder" && testCount > 0 && !nonTestFilesBelow.has(folder.path)){
            const key = targetKey("folder", folder.path);
            const row = storedByKey.get(key);
            const text = testFolderSummary(folder.path, testCount, repoName);
            const hash = inputHash("template", PROMPT_VERSION, `${folder.path}\n${text.tagline}\n${text.summary}`);
            planned.set(key, row?.inputHash === hash
                ? { kind: "folder", path: folder.path, model: "template", inputHash: hash, state: "current", status: row.status === "skipped" ? null : "skipped" }
                : { kind: "folder", path: folder.path, model: "template", inputHash: hash, state: "template", status: "skipped", templateText: text });
            continue;
        }

        const items: FolderItem[] = [];
        let settled = true;

        for (const file of filesIn.get(folder.path) ?? []){
            const child = planned.get(targetKey("file", file.path))!;
            settled &&= SETTLED.has(child.state);
            items.push({ name: file.path.slice(file.path.lastIndexOf("/") + 1), kind: "file", fileCount: 1, lineCount: file.lineCount, text: textOf(child) });
        }
        for (const sub of foldersIn.get(folder.path) ?? []){
            const child = planned.get(targetKey("folder", sub.path))!;
            settled &&= SETTLED.has(child.state);
            items.push({ name: sub.name, kind: "folder", fileCount: sub.fileCount, lineCount: linesBelow.get(sub.path) ?? 0, text: textOf(child) });
        }

        const model = kind === "repo" ? options.models.repo : options.models.folder;
        const prompt = kind === "repo"
            ? renderRepoPrompt({ name: folder.name, fileCount: folder.fileCount, folderCount: folders.length }, items)
            : renderFolderPrompt(folder, items);
        const key = targetKey(kind, folder.path);
        planned.set(key, { ...decide(kind, folder.path, model, inputHash(model, PROMPT_VERSION, prompt), storedByKey.get(key), settled, options), prompt });
    }

    // ---- queue order --------------------------------------------------------------------
    const importedBy = new Map(files.map((f) => [f.path, f.importedBy]));
    const folderByPath = new Map(folders.map((f) => [f.path, f]));
    const tier = (t: PlannedTarget): number => (t.kind === "file" ? 0 : t.kind === "folder" ? 1 : 2);

    return [...planned.values()].sort((a, b) => {
        if (tier(a) !== tier(b)) return tier(a) - tier(b);
        if (a.kind === "file") return (importedBy.get(b.path) ?? 0) - (importedBy.get(a.path) ?? 0) || compare(a.path, b.path);
        const fa = folderByPath.get(a.path)!;
        const fb = folderByPath.get(b.path)!;
        return fb.depth - fa.depth || fb.fileCount - fa.fileCount || compare(a.path, b.path);
    });
}

/** The state of one model-written target, given its stored row and whether its children are settled. */
function decide(
    kind: SummaryTargetKind,
    path: string,
    model: string,
    hash: string,
    row: StoredSummary | undefined,
    childrenSettled: boolean,
    options: PlanOptions
): PlannedTarget {
    const base = { kind, path, model, inputHash: hash };

    if (row?.batchId) return { ...base, state: "in-flight", status: null };
    if (options.failedThisRun.has(targetKey(kind, path))) return { ...base, state: "failed", status: null };
    // the text on the row was written for exactly this input (an undone edit lands here too)
    if (row?.inputHash === hash) return { ...base, state: "current", status: row.status === "fresh" ? null : "fresh" };

    const hasText = Boolean(row?.tagline);
    const status: StoredSummaryStatus = hasText ? "stale" : "pending";
    const keep = (state: TargetState): PlannedTarget => ({ ...base, state, status: row?.status === status ? null : status });

    if (kind !== "file" && hasText && !options.refreshStaleFolders) return keep("lazy");
    return keep(childrenSettled ? "ready" : "waiting");
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
