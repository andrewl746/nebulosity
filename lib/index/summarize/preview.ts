import type { Db } from "../../db/client";
import type { SummaryTargetKind } from "../../db/schema";
import {
    loadFileFacts, loadFolderFacts, loadImporters, loadSummaries, targetKey,
    type FileFacts, type FolderFacts, type StoredSummary,
} from "../../db/store/summaries";
import { commandHint } from "../../hints";
import { ASSUMED_TOKENS } from "./budget";
import { perRequestPrice, pickSample, usageStats, type UsageStats } from "./compare";
import { mapLimit } from "./concurrency";
import { DEFAULT_SUMMARY_MODELS, type ResolvedSummaryModels } from "./models";
import { planSummaries, writtenByModel, type PlannedTarget } from "./plan";
import { formatUsd, pricePerMTok, type PriceTable } from "./pricing";
import {
    FILE_SYSTEM_PROMPT, FOLDER_SYSTEM_PROMPT, importerLine, MAX_FOLDER_ITEMS, plural, PROMPT_VERSION, REPO_SYSTEM_PROMPT,
} from "./prompts";
import { buildFilePrompt, requireStructureReady } from "./run";
import type { Summarizer, SummaryOutcome } from "./types";

/*
 * The folder preview (Summary Review #3): before the full paid pass, the owner reads folder summaries for a few sample
 * folders. Every file under them goes to the file model, then their folders, bottom-up, to the folder model, with
 * exactly the prompts the real run builds, and nothing is written to the index.
 *
 * How the prompts come out exactly the same: the real run plans (planSummaries), sends what's ready, writes each answer
 * to its row, and plans again. The preview runs the same loop, but its "rows" live in memory: each answer becomes a
 * StoredSummary carrying the planner's inputHash for that target, so on the next pass the planner calls it current and
 * renders its text into the parent folder's prompt, just as it would from the database.
 */

/** A sample folder, and the one-line reason it's in the sample, which the review prints. */
export type SampleFolder = { path: string; why: string };

/** What a sample covers: every file under a sample folder, and every folder at or under one. */
export type SampleScope = {
    /** In the order given (loadFileFacts': path order). Test files are included: the planner gives them their template. */
    files: FileFacts[];
    folders: FolderFacts[];
    /** targetKeys of all of them. */
    keys: Set<string>;
    /** Sample folders the index doesn't have. */
    missing: string[];
};

/** Thrown before anything is sent when a sample folder isn't in the index (renamed upstream, or not indexed yet). */
export class SampleNotIndexedError extends Error {
    constructor(readonly paths: readonly string[]){
        super(`sample folders not in the index: ${paths.join(", ")}`);
        this.name = "SampleNotIndexedError";
    }
}

/** How many requests are in flight at once, as in the runner's regular-API waves. */
export const PREVIEW_CONCURRENCY = 4;

/** Review #1 and #2's sample size: the review shows the new "Imported by" line for those same files. */
const REVIEW_1_SAMPLE_SIZE = 20;

const SYSTEM_PROMPTS: Record<SummaryTargetKind, string> = {
    file: FILE_SYSTEM_PROMPT,
    folder: FOLDER_SYSTEM_PROMPT,
    repo: REPO_SYSTEM_PROMPT,
};

const keyOf = (target: { kind: SummaryTargetKind; path: string }): string => targetKey(target.kind, target.path);

/** The folder "" is the repo itself, as the planner names it. */
const folderKind = (folderPath: string): SummaryTargetKind => (folderPath === "" ? "repo" : "folder");

/** Whether a path is the folder itself or inside it, by whole segments ("src/app" doesn't contain "src/application.ts"). */
const isUnder = (p: string, folder: string): boolean => folder === "" || p === folder || p.startsWith(`${folder}/`);

/** Which files and folders a sample covers. Pure. */
export function selectSample(files: readonly FileFacts[], folders: readonly FolderFacts[], samplePaths: readonly string[]): SampleScope {
    const covered = (p: string): boolean => samplePaths.some((sample) => isUnder(p, sample));
    const known = new Set(folders.map((f) => f.path));
    const scopedFiles = files.filter((f) => covered(f.path));
    const scopedFolders = folders.filter((f) => covered(f.path));

    return {
        files: scopedFiles,
        folders: scopedFolders,
        keys: new Set([...scopedFiles.map((f) => targetKey("file", f.path)), ...scopedFolders.map((f) => targetKey(folderKind(f.path), f.path))]),
        missing: samplePaths.filter((sample) => !known.has(sample)),
    };
}

/**
 * The next wave: the plan's ready targets inside the sample that haven't been sent, in the plan's order. Bottom-up
 * comes from the planner: a folder is ready only once every child is settled (answered, failed, current or a template),
 * so a folder always goes in a later wave than its subfolders. Pure.
 */
export function nextWave(plan: readonly PlannedTarget[], scope: SampleScope, sent: ReadonlySet<string>): PlannedTarget[] {
    return plan.filter((t) => t.state === "ready" && scope.keys.has(keyOf(t)) && !sent.has(keyOf(t)));
}

/**
 * An answer as the row the real run would write for it (writeResults): its text and model, the planned inputHash, and
 * status "fresh". The planner reads only the hash, the batch id and the text, so it now calls the target current and
 * shows this text in its folder's prompt. A row the index already had keeps its id; a new one has none (0), since
 * it's never written. Pure.
 */
export function answeredRow(target: PlannedTarget, outcome: Extract<SummaryOutcome, { ok: true }>, previous: StoredSummary | undefined): StoredSummary {
    return {
        id: previous?.id ?? 0,
        kind: target.kind,
        path: target.path,
        tagline: outcome.text.tagline,
        summary: outcome.text.summary,
        model: outcome.model,
        inputHash: target.inputHash,
        promptVersion: null,
        status: "fresh",
        batchId: null,
        error: null,
    };
}

export type PreviewInput = {
    files: readonly FileFacts[];
    folders: readonly FolderFacts[];
    /** The index's summaries: a current one is used as it is, not sent again. */
    stored: readonly StoredSummary[];
    /** The sample folders' paths. */
    sample: readonly string[];
    summarizer: Summarizer;
    /** A file's prompt (buildFilePrompt), or null when the file changed after indexing: that counts as a failure. */
    filePrompt: (file: FileFacts) => string | null;
    /** The summary models setting, as a real run would resolve it (ADR-066). Default: the built-in models. */
    models?: ResolvedSummaryModels;
    concurrency?: number;
    onProgress?: (message: string) => void;
};

export type FolderPreview = {
    scope: SampleScope;
    /** Each wave's targetKeys, in the order they were sent. */
    waves: string[][];
    /** What came back for every target sent, by targetKey. */
    answers: Map<string, SummaryOutcome>;
    /** The sample's targets in the last plan (made after the last wave), in plan order, by targetKey. */
    final: Map<string, PlannedTarget>;
    /** The in-memory rows at the end: the index's own, plus one for every answer. */
    rows: Map<string, StoredSummary>;
};

/**
 * The preview's loop, with no database: plan, send the sample's ready targets, record the answers as in-memory rows,
 * plan again. It ends when a plan has nothing ready left in the sample. That always comes: every wave sends at least
 * one target never sent before, and the sample is finite. A folder that never becomes ready (a child in a batch at
 * Anthropic, say) is left out, and unfinished() names it.
 */
export async function runFolderPreview(input: PreviewInput): Promise<FolderPreview> {
    const scope = selectSample(input.files, input.folders, input.sample);
    if (scope.missing.length > 0) throw new SampleNotIndexedError(scope.missing);

    const say = input.onProgress ?? (() => {});
    const fileByPath = new Map(input.files.map((f) => [f.path, f]));
    const rows = new Map(input.stored.map((row) => [keyOf(row), row]));
    // as in the runner: a failed target is settled for the rest of the run, so its folder still goes out
    const failedThisRun = new Set<string>();
    const sent = new Set<string>();
    const answers = new Map<string, SummaryOutcome>();
    const waves: string[][] = [];
    const setting = input.models ?? DEFAULT_SUMMARY_MODELS;

    const send = (target: PlannedTarget): Promise<SummaryOutcome> => {
        const customId = keyOf(target);
        const prompt = target.kind === "file" ? input.filePrompt(fileByPath.get(target.path)!) : (target.prompt ?? null);
        if (prompt === null){
            return Promise.resolve({ customId, ok: false, error: `${target.path} changed after it was indexed; run ${commandHint("index", "<path-to-repo>")} first`, model: null, usage: null });
        }
        // as the runner builds it: a set model goes without the Sonnet fallback beta (ADR-066, R3)
        const customModel = setting.custom[target.kind];
        return input.summarizer.summarize({ customId, model: target.model, system: SYSTEM_PROMPTS[target.kind], prompt, ...(customModel ? { customModel } : {}) });
    };

    for (;;){
        // refreshStaleFolders: true, as in a full run (npm run summarize): an out-of-date folder is redone, not left lazy
        const plan = planSummaries(input.files, input.folders, [...rows.values()], { models: setting.models, refreshStaleFolders: true, failedThisRun });
        const wave = nextWave(plan, scope, sent);

        if (wave.length === 0){
            const final = new Map(plan.filter((t) => scope.keys.has(keyOf(t))).map((t) => [keyOf(t), t]));
            return { scope, waves, answers, final, rows };
        }

        const number = waves.length + 1;
        waves.push(wave.map(keyOf));
        for (const target of wave) sent.add(keyOf(target));   // claimed before sending: nothing goes twice
        say(`wave ${number}: ${waveLabel(wave)}`);

        let answered = 0;
        const outcomes = await mapLimit(wave, input.concurrency ?? PREVIEW_CONCURRENCY, async (target) => {
            const outcome = await send(target);
            answered++;
            if (answered % 25 === 0 && answered < wave.length) say(`wave ${number}: ${answered} of ${wave.length} answered`);
            return outcome;
        });

        wave.forEach((target, i) => {
            const outcome = outcomes[i];
            answers.set(keyOf(target), outcome);
            if (outcome.ok) rows.set(keyOf(target), answeredRow(target, outcome, rows.get(keyOf(target))));
            else failedThisRun.add(keyOf(target));
        });
        const failed = outcomes.filter((o) => !o.ok).length;
        say(`wave ${number} done: ${outcomes.length - failed} summarized, ${failed} failed`);
    }
}

/** "6 files", "3 folders", "128 files and 2 folders". */
function waveLabel(wave: readonly PlannedTarget[]): string {
    const files = wave.filter((t) => t.kind === "file").length;
    const folders = wave.length - files;
    return [files > 0 ? plural(files, "file") : null, folders > 0 ? plural(folders, "folder") : null].filter(Boolean).join(" and ");
}

/**
 * The sample's targets that never went out and aren't settled without a request (current in the index, or a test
 * file's template): stuck behind something that never came, such as a child in a batch at Anthropic. In plan order.
 */
export function unfinished(preview: FolderPreview): PlannedTarget[] {
    return [...preview.final.values()].filter((t) => !preview.answers.has(keyOf(t)) && t.state !== "current" && t.state !== "template");
}

/**
 * The preview against an indexed repo: reads its facts and summaries (and writes nothing, not even to summary_usage),
 * runs the loop with buildFilePrompt's real file prompts, and adds what the review needs from the graph.
 */
export async function previewRepoFolders(
    db: Db, repoId: number, root: string, samples: readonly SampleFolder[], summarizer: Summarizer, onProgress?: (message: string) => void,
    models?: ResolvedSummaryModels
): Promise<Pick<FolderPreviewReport, "preview" | "importerLines" | "fullPass">> {
    requireStructureReady(db, repoId);
    const files = loadFileFacts(db, repoId);
    const folders = loadFolderFacts(db, repoId);

    // Review #1's sample, with the "Imported by" line their prompts carry now: from the graph, no API call
    const importerLines = pickSample(files, REVIEW_1_SAMPLE_SIZE)
        .map((file) => ({ path: file.path, line: importerLine(file.path, loadImporters(db, repoId, file.path)) }));

    const preview = await runFolderPreview({
        files, folders, stored: loadSummaries(db, repoId), sample: samples.map((s) => s.path), summarizer,
        filePrompt: (file) => buildFilePrompt(db, repoId, root, file),
        models,
        onProgress,
    });

    return { preview, importerLines, fullPass: { files: files.filter((f) => writtenByModel(f)).length, folders: folders.length } };
}

export type FolderPreviewReport = {
    title: string;
    repo: string;
    effort: string;
    models: { file: string; folder: string };
    /** The summary models setting's prices, checked before the built-in table (ADR-066). */
    prices?: PriceTable;
    samples: readonly SampleFolder[];
    preview: FolderPreview;
    /** The "Imported by" line of each file in Review #1's sample. */
    importerLines: readonly { path: string; line: string }[];
    /** What the real first pass will send: model-written files, and folders plus the repo. */
    fullPass: { files: number; folders: number };
};

/** The review: header and sample, importer lines, cost, the full-pass estimate, then each sample folder's summaries. Pure. */
export function renderFolderPreview(report: FolderPreviewReport): string {
    const { preview, models, fullPass } = report;
    const n = (x: number): string => x.toLocaleString("en-US");

    const sent = [...preview.final.values()].filter((t) => preview.answers.has(keyOf(t)));
    const sentFiles = sent.filter((t) => t.kind === "file");
    const sentFolders = sent.filter((t) => t.kind !== "file");
    const fileStats = usageStats(models.file, sentFiles.map((t) => preview.answers.get(keyOf(t))), report.prices);
    const folderStats = usageStats(models.folder, sentFolders.map((t) => preview.answers.get(keyOf(t))), report.prices);
    const tests = preview.scope.files.filter((f) => f.isTest).length;
    const problems = failures(preview);

    // The estimate multiplies what it prints (perRequestPrice, rounded token means), so each line can be redone by hand.
    const filePrice = perRequestPrice(fileStats.meanCost);
    const filesTotal = (fullPass.files * filePrice.value) / 2;
    const folderPrice = pricePerMTok(models.folder, report.prices) ?? { input: 0, output: 0 };
    const meanIn = Math.round(folderStats.meanInputTokens);
    const meanOut = Math.round(folderStats.meanOutputTokens);
    const foldersTotal = (fullPass.folders * (meanIn * folderPrice.input + meanOut * folderPrice.output)) / 1_000_000 / 2;
    const unpriced = fileStats.unpriced || folderStats.unpriced;

    const lines = [
        `## ${report.title}`,
        "",
        `- **Repo:** \`${report.repo}\` · **effort** ${report.effort} · **prompt version** ${PROMPT_VERSION} · the regular Messages API`,
        `- **Sample:** ${plural(report.samples.length, "folder")} (below): ${plural(sentFiles.length, "file")} went to ${models.file},`
            + ` then ${plural(sentFolders.length, "folder")} to ${models.folder}, bottom-up in ${plural(preview.waves.length, "wave")},`
            + ` with exactly the prompts a real run builds. ${plural(tests, "test file")} got the template, as in a real run. Nothing was written to the index.`,
        ...(problems.length === 0
            ? ["- **Failures:** none."]
            : [`- **Failures (${problems.length}):**`, ...problems.map((p) => `  - \`${p.path}\` (${p.kind}): ${p.text}`)]),
        "",
        "| Folder | Files | Test files | Why |",
        "|---|---|---|---|",
        ...report.samples.map((sample) => {
            const folder = preview.scope.folders.find((f) => f.path === sample.path);
            const sampleTests = preview.scope.files.filter((f) => f.isTest && isUnder(f.path, sample.path)).length;
            return `| \`${sample.path}\` | ${n(folder?.fileCount ?? 0)} | ${n(sampleTests)} | ${sample.why} |`;
        }),
        "",
        "### \"Imported by\", grouped by area",
        "",
        `The line each file of Review #1's sample (${plural(report.importerLines.length, "file")}) now carries in its prompt, from the import graph (no API call):`,
        "",
        ...report.importerLines.map((l) => `- \`${l.path}\`: ${l.line}`),
        "",
        "### Cost on this sample",
        "",
        "| Model | Requests | Input tokens | Output tokens | Mean input | Mean output | Cost |",
        "|---|---|---|---|---|---|---|",
        costRow(fileStats, "files"),
        costRow(folderStats, "folders"),
        "",
        `**Total:** ${unpriced ? "at least " : ""}${formatUsd(fileStats.cost + folderStats.cost)}`,
        "",
        "### Full-pass estimate (Batch API, half price)",
        "",
        `- **Files:** ${n(fullPass.files)} × ${filePrice.text} (${models.file}'s mean) × ½ = **${formatUsd(filesTotal)}**`,
        `- **Folders and the repo:** ${n(fullPass.folders)} × (${n(meanIn)} input tokens + ${n(meanOut)} output tokens at ${models.folder}'s price) × ½ = **${formatUsd(foldersTotal)}**`,
        `- **Total ≈ ${formatUsd(filesTotal + foldersTotal)}** against S2's $15.`,
        "",
        `The folder means are measured on this sample's ${plural(folderStats.requests, "folder request")}, in place of the`
            + ` ${n(ASSUMED_TOKENS.folder.inputTokens)} input tokens assumed before. The sample skews toward small folders, and the full pass`
            + ` has folders whose prompts list up to ${MAX_FOLDER_ITEMS} children, so its mean may be higher.`,
        ...biggestFolderLine(preview),
        "",
        "### The folders",
        ...report.samples.flatMap((sample, i) => folderSection(report, sample, i + 1)),
        "",
        "### Owner's verdict",
        "",
        "_To fill in: go or no-go for the full run, and any prompt changes first._",
    ];
    return lines.join("\n") + "\n";
}

function costRow(stats: UsageStats, role: string): string {
    const n = (x: number): string => x.toLocaleString("en-US");
    return `| ${stats.model} (${role}) | ${n(stats.requests)} | ${n(stats.inputTokens)} | ${n(stats.outputTokens)}`
        + ` | ${n(Math.round(stats.meanInputTokens))} | ${n(Math.round(stats.meanOutputTokens))} | ${stats.unpriced ? "at least " : ""}${formatUsd(stats.cost)} |`;
}

/** Every failed request and every target left unfinished, in plan order. */
function failures(preview: FolderPreview): { kind: SummaryTargetKind; path: string; text: string }[] {
    const stuck = new Set(unfinished(preview).map(keyOf));
    return [...preview.final.values()].flatMap((t) => {
        const outcome = preview.answers.get(keyOf(t));
        if (outcome && !outcome.ok) return [{ kind: t.kind, path: t.path, text: `failed: ${outcome.error}` }];
        return stuck.has(keyOf(t)) ? [{ kind: t.kind, path: t.path, text: `not summarized (${t.state})` }] : [];
    });
}

/**
 * The measured tokens of the sample's folder with the most items directly inside (files plus subfolders; the first by
 * path on a tie): the sample's small folders can't show how big a full folder's prompt gets.
 */
function biggestFolderLine(preview: FolderPreview): string[] {
    const subfolders = new Map<string, number>();
    for (const folder of preview.scope.folders){
        if (folder.parentPath !== null) subfolders.set(folder.parentPath, (subfolders.get(folder.parentPath) ?? 0) + 1);
    }

    let biggest: { folder: FolderFacts; items: number } | null = null;
    for (const folder of preview.scope.folders){
        const items = folder.directFileCount + (subfolders.get(folder.path) ?? 0);
        if (!biggest || items > biggest.items) biggest = { folder, items };
    }
    if (!biggest) return [];

    const { folder, items } = biggest;
    const key = targetKey(folderKind(folder.path), folder.path);
    const outcome = preview.answers.get(key);
    const measured = outcome?.usage
        ? `${outcome.usage.reduce((sum, u) => sum + u.inputTokens, 0).toLocaleString("en-US")} input tokens and`
            + ` ${outcome.usage.reduce((sum, u) => sum + u.outputTokens, 0).toLocaleString("en-US")} output tokens`
        : outcome && !outcome.ok ? `failed: ${outcome.error}` : `not summarized (${preview.final.get(key)?.state ?? "not planned"})`;
    const capped = items > MAX_FOLDER_ITEMS ? `; its prompt lists the largest ${MAX_FOLDER_ITEMS}` : "";

    return ["", `- **The biggest folder here:** \`${folder.path}\` (${plural(items, "item")} directly inside${capped}): ${measured}.`];
}

/**
 * One sample folder: its own summary first, each subfolder indented beneath its parent (a folder before the folders
 * inside it), then its files' summaries folded into a <details> block so the folder summaries stay readable.
 */
function folderSection(report: FolderPreviewReport, sample: SampleFolder, number: number): string[] {
    const { preview } = report;
    const lines = ["", `#### ${number}. \`${sample.path}\``, "", `_${sample.why}_`, ""];

    // the sample's folders by parent, in path order (so siblings come by name)
    const children = new Map<string, FolderFacts[]>();
    for (const folder of preview.scope.folders){
        if (folder.parentPath === null || !isUnder(folder.path, sample.path) || folder.path === sample.path) continue;
        const list = children.get(folder.parentPath) ?? [];
        list.push(folder);
        children.set(folder.parentPath, list);
    }

    const walk = (folder: FolderFacts, depth: number): void => {
        lines.push(`${"  ".repeat(depth)}- **\`${folder.name}/\`** (${plural(folder.fileCount, "file")}): ${shown(preview, folderKind(folder.path), folder.path)}`);
        for (const child of children.get(folder.path) ?? []) walk(child, depth + 1);
    };
    const top = preview.scope.folders.find((f) => f.path === sample.path);
    if (top) walk(top, 0);

    const files = preview.scope.files.filter((f) => !f.isTest && isUnder(f.path, sample.path));
    const relative = (p: string): string => (sample.path === "" ? p : p.slice(sample.path.length + 1));
    lines.push(
        "",
        `<details><summary>${plural(files.length, "file summary", "file summaries")} (${report.models.file})</summary>`,
        "",
        ...files.map((f) => `- \`${relative(f.path)}\` (${plural(f.lineCount, "line")}): ${shown(preview, "file", f.path)}`),
        "",
        "</details>",
    );
    return lines;
}

/** A target's summary as the review shows it: the answer, its failure, a summary the index already had, or why there's none. */
function shown(preview: FolderPreview, kind: SummaryTargetKind, targetPath: string): string {
    const key = targetKey(kind, targetPath);
    const target = preview.final.get(key);
    const outcome = preview.answers.get(key);

    if (outcome){
        if (!outcome.ok) return `failed: ${outcome.error}`;
        // a server-side fallback's answer isn't the summary the model asked would have written, and the reader should know
        const by = outcome.model === target?.model ? "" : ` (answered by ${outcome.model})`;
        return `*${outcome.text.tagline}* — ${outcome.text.summary}${by}`;
    }

    const row = preview.rows.get(key);
    if (target?.state === "current" && row?.tagline) return `*${row.tagline}* — ${row.summary} (already in the index, not sent again)`;
    return `not summarized (${target?.state ?? "not planned"})`;
}
