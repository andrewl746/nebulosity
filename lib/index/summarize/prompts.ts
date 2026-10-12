import type { Importer, SummaryText } from "../../db/store/summaries";
import { countLines } from "../languages/typescript";
import { dirOf } from "../paths";

/** Part of every inputHash. Bump it to redo every summary on purpose (a better prompt, new settings). Version 2: ADR-034. */
export const PROMPT_VERSION = 2;

/** Who writes what (ADR-028): Haiku for the many files, Sonnet for the folders and the repo people read first. */
export const SUMMARY_MODELS = {
    file: "claude-haiku-5-5",
    folder: "claude-sonnet-5-5",
    repo: "claude-sonnet-5-5",
} as const;

/** Summaries are short and factual, so low effort keeps thinking (and cost) small. Tunable (PIVOT_SPEC.md §5.3). */
export const SUMMARY_EFFORT = "low" as const;

/** Room for the reply plus whatever thinking low effort does. Unused tokens cost nothing. */
export const MAX_OUTPUT_TOKENS = 4096;

/** About 6k tokens of source (PIVOT_SPEC.md §5.3): code runs roughly 3.5 characters per token. */
export const MAX_SOURCE_CHARS = 20_000;

/** A folder's prompt lists at most this many of its children, largest first. */
export const MAX_FOLDER_ITEMS = 50;

/** A file's prompt names this many of the folders its importers sit in; the rest fold into a count. */
export const MAX_IMPORTER_FOLDERS = 3;

// Prompt v2 (ADR-034). The taglines' examples are deliberately not from VS Code, so the model can't copy one into a summary.
export const FILE_SYSTEM_PROMPT = [
    "You write the summary a developer sees for one source file while exploring an unfamiliar codebase.",
    "Give a tagline and a summary. The tagline is a noun phrase of 3 to 6 plain words, like \"Retry policy with exponential backoff\". The summary is 2 to 4 sentences.",
    "The summary says what the file is responsible for, names its most important exports, and says how other code uses it. The \"Imported by\" line comes from the repository's import graph; use it to say how widely and where the file is used.",
    "In the summary, write identifiers (functions, classes, types, variables and file names) in backticks, like `parseConfig`.",
    "Use real identifiers from the file. Don't narrate the code line by line, and don't guess beyond what you're shown. Don't mention truncation or code you weren't shown.",
].join("\n");

export const FOLDER_SYSTEM_PROMPT = [
    "You write the summary a developer sees for one folder while exploring an unfamiliar codebase. You're given the summaries of the files and subfolders inside it.",
    "Give a tagline and a summary. The tagline is a noun phrase of 3 to 6 plain words, like \"Payment provider integrations\". The summary is 2 to 4 sentences.",
    "The summary says what the folder is responsible for as a whole, which parts matter most, and how they fit together.",
    "In the summary, write file, folder, function and class names in backticks, like `retry.ts`.",
    "Don't list every item, and don't guess beyond the summaries you're given.",
].join("\n");

export const REPO_SYSTEM_PROMPT = [
    "You write the overview a developer sees first when opening an unfamiliar repository. You're given the summaries of its top-level folders and files.",
    "Give a tagline and a summary. The tagline is a noun phrase of 3 to 6 plain words, like \"Distributed task scheduling service\". The summary is 2 to 4 sentences.",
    "The summary says what the project is, names its main areas, and says where a newcomer should start reading.",
    "In the summary, write folder and file names in backticks, like `src/server`.",
    "Don't guess beyond the summaries you're given.",
].join("\n");

/** One child of a folder, as its prompt shows it. lineCount is a folder's total, used only for ordering. */
export type FolderItem = { name: string; kind: "file" | "folder"; fileCount: number; lineCount: number; text: SummaryText | null };

/** "1 line", "9 lines", "12,103 files". Pass the plural form when it isn't the word plus "s", as in ("batch", "batches"). */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? word : pluralWord}`;
}

/**
 * A file's prompt: the imports/exports listing chunks.ts generates (it opens with
 * "File: <path>"), the line count, who imports the file, then the source, cut to about 6k tokens.
 */
export function renderFilePrompt(
    listing: string,
    lineCount: number,
    importers: readonly Importer[],
    source: string,
    maxChars: number = MAX_SOURCE_CHARS
): string {
    return [listing, "", `Lines: ${lineCount}`, importerLine(importers), "", "Source:", truncateSource(source, maxChars)].join("\n");
}

/**
 * How widely a file is used, from the import graph: a source file can't say who imports it, so the model is
 * told. Test files are counted apart and tallied last (", plus 2 test files"): on a central file the biggest
 * importer folders are test folders, which would skew how its use looks. The total, the folders and the
 * examples come from the other importers: counted per folder, biggest first (ties by folder path, compared
 * with plain `<` so the order never depends on a locale and the same graph always gives the same line), with
 * the first maxFolders named and the rest folded into a count. A top-level file's folder is "" (it sorts first
 * on a tie) and is shown as "the repo root".
 */
export function importerLine(importers: readonly Importer[], maxFolders: number = MAX_IMPORTER_FOLDERS): string {
    if (importers.length === 0) return "Imported by: no other indexed file";

    const nonTests = importers.filter((importer) => !importer.isTest);
    const tests = importers.length - nonTests.length;
    if (nonTests.length === 0) return `Imported by: only ${plural(tests, "test file")}`;

    const perFolder = new Map<string, number>();
    for (const { path } of nonTests){
        const folder = dirOf(path);
        perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
    }

    const ranked = [...perFolder].sort(([folderA, countA], [folderB, countB]) =>
        countB - countA || (folderA < folderB ? -1 : folderA > folderB ? 1 : 0));
    const named = ranked.slice(0, maxFolders).map(([folder, count]) => `${folder === "" ? "the repo root" : folder} (${count})`);

    let line = `Imported by: ${plural(nonTests.length, "file")} in ${plural(ranked.length, "folder")}: ${named.join(", ")}`;
    if (ranked.length > maxFolders) line += `, and ${plural(ranked.length - maxFolders, "other folder")}`;
    if (tests > 0) line += `, plus ${plural(tests, "test file")}`;
    return line;
}

export function renderFolderPrompt(
    folder: { path: string; fileCount: number; directFileCount: number },
    items: readonly FolderItem[],
    maxItems: number = MAX_FOLDER_ITEMS
): string {
    return [
        `Folder: ${folder.path}`,
        `${plural(folder.fileCount, "source file")} in total, ${folder.directFileCount} directly inside.`,
        "",
        "Contents, largest first:",
        ...listItems(items, maxItems),
    ].join("\n");
}

export function renderRepoPrompt(
    repo: { name: string; fileCount: number; folderCount: number },
    items: readonly FolderItem[],
    maxItems: number = MAX_FOLDER_ITEMS
): string {
    return [
        `Repository: ${repo.name}`,
        `${plural(repo.fileCount, "source file")} in ${plural(repo.folderCount, "folder")}.`,
        "",
        "Top-level contents, largest first:",
        ...listItems(items, maxItems),
    ].join("\n");
}

/** Largest first (by lines), ties by name; the overflow becomes one "…and N smaller items" line. */
function listItems(items: readonly FolderItem[], maxItems: number): string[] {
    const sorted = [...items].sort((a, b) => b.lineCount - a.lineCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const lines = sorted.slice(0, maxItems).map((item) => {
        const label = item.kind === "folder"
            ? `${item.name}/ (${plural(item.fileCount, "file")})`
            : `${item.name} (${plural(item.lineCount, "line")})`;
        return `- ${label}: ${item.text ? `${item.text.tagline} — ${item.text.summary}` : "(no summary yet)"}`;
    });

    const hidden = sorted.length - maxItems;
    if (hidden > 0) lines.push(`- …and ${plural(hidden, "smaller item")}`);
    return lines;
}

/** The first maxChars of a file, cut at a line break when there is one, plus a note saying how much is missing. */
export function truncateSource(source: string, maxChars: number = MAX_SOURCE_CHARS): string {
    if (source.length <= maxChars) return source;

    const cut = source.lastIndexOf("\n", maxChars);
    const kept = cut > 0 ? source.slice(0, cut) : source.slice(0, maxChars);
    const rest = source.slice(cut > 0 ? cut + 1 : maxChars);
    return `${kept}\n… (truncated: ${plural(countLines(rest), "more line")})`;
}

/** Test files skip the model (PIVOT_SPEC.md §5.3). This template says what they are from the path alone. */
export function testFileSummary(filePath: string, lineCount: number): SummaryText {
    const base = filePath.slice(filePath.lastIndexOf("/") + 1);
    const subject = base.replace(/\.(test|spec)(?=\.[cm]?[jt]sx?$)/, "").replace(/\.[cm]?[jt]sx?$/, "");
    return {
        tagline: `Tests for ${subject}`,
        summary: `Test code (${plural(lineCount, "line")}) for ${subject}. Test files get this template instead of a model-written summary.`,
    };
}
