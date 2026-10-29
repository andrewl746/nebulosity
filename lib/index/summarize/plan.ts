import { createHash } from "crypto";
import type { StoredSummaryStatus, SummaryTargetKind } from "../../db/schema";
import { targetKey, type FileFacts, type FolderFacts, type StoredSummary, type SummaryText } from "../../db/store/summaries";
import { DEFAULT_MAX_FILE_BYTES } from "../discover";
import { dirOf } from "../paths";
import {
    folderTier, importsOnlyFileSummary, MAX_FOLDER_ITEMS, PROMPT_VERSION, renderFolderPrompt, renderRepoPrompt, testFileSummary,
    testFolderSummary, UNRECORDED_PROMPT_VERSION, withLengthLine, writtenInOlderStyle, type FolderItem,
} from "./prompts";

/**
 * current: the text matches the current input, or an older prompt wrote it for this same input (P1) ·
 * template: a test file or test-only folder whose template is missing or out of date, written right away ·
 * ready: needs a model and can go now ·
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
    /** Folders and the repo, ending with the length line. A file's prompt is built from disk when it's sent. */
    prompt?: string;
    /** planned to be written only because an older prompt version wrote its text (P1) */
    restyle?: true;
};

/** Which summaries an older prompt wrote a plan restyles (PlanOptions.restyle). */
export type Restyle = "all" | "none" | { path: string };

export type PlanOptions = {
    models: { readonly file: string; readonly folder: string; readonly repo: string };
    /** true redoes out-of-date folders now (a full run); false leaves them lazy until opened (incremental runs). */
    refreshStaleFolders: boolean;
    /** targetKeys that failed earlier in this run: they wait for the next run. */
    failedThisRun: ReadonlySet<string>;
    /**
     * A non-test file over this was indexed for its imports only and gets a template (ADR-053). Default: the indexer's
     * cap, DEFAULT_MAX_FILE_BYTES, the product's only one; tests pass another to match an index they built with it.
     */
    maxFileBytes?: number;
    /**
     * which summaries an older prompt version wrote, with their input otherwise unchanged, are redone in the current
     * style: every one (a full run and its estimate), the one a panel opened (summarizeNow), or none (the automatic jobs
     * and the stage refresh). Default: "none".
     */
    restyle?: Restyle;
};

/**
 * Whether a model writes this file's summary: a test file and a file over the size cap get a template instead (ADR-053).
 * The planner and every full-pass cost estimate ask here, so they count the same files.
 */
export function writtenByModel(file: Pick<FileFacts, "isTest" | "sizeBytes">, maxFileBytes: number = DEFAULT_MAX_FILE_BYTES): boolean {
    return !file.isTest && file.sizeBytes <= maxFileBytes;
}

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
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

    // the text a target shows right now: its fresh template, else whatever its row holds
    const textOf = (target: PlannedTarget): SummaryText | null => {
        if (target.templateText) return target.templateText;
        const row = storedByKey.get(targetKey(target.kind, target.path));
        return row?.tagline && row.summary !== null ? { tagline: row.tagline, summary: row.summary } : null;
    };

    // whether this plan restyles the target at `path`: a file and a folder never share a path, and only the repo's is ""
    const restyled = (path: string): boolean =>
        options.restyle === "all" || (typeof options.restyle === "object" && options.restyle.path === path);

    // ---- files: independent of each other ---------------------------------------------
    for (const file of files){
        const key = targetKey("file", file.path);
        const row = storedByKey.get(key);

        // a test file, and a file over the size cap (indexed for its imports only), get a template rather than a model
        if (!writtenByModel(file, maxFileBytes)){
            const text = file.isTest ? testFileSummary(file.path, file.lineCount) : importsOnlyFileSummary(file.lineCount, maxFileBytes);
            const hash = inputHash("template", PROMPT_VERSION, `${file.path}\n${text.tagline}\n${text.summary}`);
            const current = row?.inputHash === hash;
            planned.set(key, current
                ? { kind: "file", path: file.path, model: "template", inputHash: hash, state: "current", status: row.status === "skipped" ? null : "skipped" }
                : { kind: "file", path: file.path, model: "template", inputHash: hash, state: "template", status: "skipped", templateText: text });
            continue;
        }

        // A file's prompt is built from its bytes, so its content hash stands in for the prompt
        // here: same bytes, same prompt. Planning then never has to read source files. Older
        // prompt versions hashed the same stand-in.
        const input = `file\n${file.path}\n${file.contentHash}`;
        planned.set(key, decide("file", file.path, options.models.file, { input, olderInput: () => input, restyled: restyled(file.path) }, row, true, options));
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
        const repo = { name: folder.name, fileCount: folder.fileCount, folderCount: folders.length };
        // The body is hashed without the length line (P2): the line follows from the file count, which the body
        // holds, and from the prompt version, which the hash holds. The prompt sent ends with it.
        const body = kind === "repo" ? renderRepoPrompt(repo, items) : renderFolderPrompt(folder, items);
        // the body as prompt v2 rendered it, each child's summary verbatim, for the older check (P2): v2 is the only
        // older version that stored summaries
        const olderInput = (): string => (kind === "repo"
            ? renderRepoPrompt(repo, items, MAX_FOLDER_ITEMS, false)
            : renderFolderPrompt(folder, items, MAX_FOLDER_ITEMS, false));
        const prompt = withLengthLine(body, kind, kind === "repo" ? "large" : folderTier(folder.fileCount));
        const key = targetKey(kind, folder.path);
        planned.set(key, {
            ...decide(kind, folder.path, model, { input: body, olderInput, restyled: restyled(folder.path) }, storedByKey.get(key), settled, options),
            prompt,
        });
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

/**
 * The folders and the repo that writing `below` will put out of date (ruling R24, the pre-ship pass's final review A-I1):
 * every model-written folder above one of them, and the repo, that isn't in `below` itself. Pure.
 *
 * A folder's prompt is built from its children's stored text, so while they wait to be rewritten it plans as current.
 * Once they are, its input changes and a full run redoes it. After a file model change that's every folder in the repo,
 * so the estimate and the spend cap have to count them before the files go. Left out:
 * - test-only folders, which get a template;
 * - a folder that failed this run, which waits for the next; nothing above it changes through it.
 */
export function foldersAbove(targets: readonly PlannedTarget[], below: readonly PlannedTarget[]): PlannedTarget[] {
    const byKey = new Map(targets.map((t) => [targetKey(t.kind, t.path), t]));
    const seen = new Set(below.map((t) => targetKey(t.kind, t.path)));
    const above = new Set<string>();

    for (const target of below){
        if (target.kind === "repo") continue;
        for (let dir: string | null = dirOf(target.path); dir !== null; dir = dir === "" ? null : dirOf(dir)){
            const key = targetKey(dir === "" ? "repo" : "folder", dir);
            // already counted, with what's above it: below's own walk, or an earlier one, covers the rest of the way up
            if (seen.has(key)) break;
            seen.add(key);
            const folder = byKey.get(key);
            if (!folder || folder.model === "template" || folder.state === "failed") break;
            above.add(key);
        }
    }
    // in queue order: deepest first, the repo last
    return targets.filter((t) => above.has(targetKey(t.kind, t.path)));
}

/** What decide() hashes for one model-written target, and whether the plan restyles it. */
type TargetInput = {
    /** The input under the current prompt version: a file's stand-in, or a folder's or the repo's prompt body. */
    input: string;
    /** The input as an older prompt version rendered it (P2), rendered only when a row an older prompt wrote missed input's hash. */
    olderInput: () => string;
    /** Whether PlanOptions.restyle names this target. */
    restyled: boolean;
};

/**
 * The state of one model-written target, given its input, its stored row and whether its children are settled. A row
 * an older prompt wrote for the same input is older style only (P1): current, unless the plan restyles it.
 */
function decide(
    kind: SummaryTargetKind,
    path: string,
    model: string,
    { input, olderInput, restyled }: TargetInput,
    row: StoredSummary | undefined,
    childrenSettled: boolean,
    options: PlanOptions
): PlannedTarget {
    const hash = inputHash(model, PROMPT_VERSION, input);
    const base = { kind, path, model, inputHash: hash };

    if (row?.batchId) return { ...base, state: "in-flight", status: null };
    if (options.failedThisRun.has(targetKey(kind, path))) return { ...base, state: "failed", status: null };
    // the text on the row was written for exactly this input (an undone edit lands here too)
    if (row?.inputHash === hash) return { ...base, state: "current", status: row.status === "fresh" ? null : "fresh" };
    // older style only (P1): a model wrote it with an older prompt, and its input hasn't changed since
    if (row && writtenInOlderStyle(row) && row.inputHash === inputHash(model, row.promptVersion ?? UNRECORDED_PROMPT_VERSION, olderInput())){
        const status = row.status === "fresh" ? null : "fresh";
        if (!restyled) return { ...base, state: "current", status };
        if (kind !== "file" && !options.refreshStaleFolders) return { ...base, state: "lazy", status, restyle: true };
        return { ...base, state: childrenSettled ? "ready" : "waiting", status, restyle: true };
    }

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
