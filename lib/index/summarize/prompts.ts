import type { SummaryText } from "../../db/store/summaries";
import { countLines } from "../languages/typescript";

/** Part of every inputHash. Bump it to redo every summary on purpose (a better prompt, new settings). */
export const PROMPT_VERSION = 1;

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

export const FILE_SYSTEM_PROMPT = [
    "You write the summary a developer sees for one source file while exploring an unfamiliar codebase.",
    "Give a tagline of at most 6 words and a summary of 2 to 4 sentences.",
    "The summary says what the file is responsible for, names its most important exports, and says how other code uses it when the source makes that clear.",
    "Use real identifiers from the file. Don't narrate the code line by line, and don't guess beyond what you're shown; if the source is truncated, summarize what's there.",
].join("\n");

export const FOLDER_SYSTEM_PROMPT = [
    "You write the summary a developer sees for one folder while exploring an unfamiliar codebase. You're given the summaries of the files and subfolders inside it.",
    "Give a tagline of at most 6 words and a summary of 2 to 4 sentences.",
    "The summary says what the folder is responsible for as a whole, which parts matter most, and how they fit together.",
    "Don't list every item, and don't guess beyond the summaries you're given.",
].join("\n");

export const REPO_SYSTEM_PROMPT = [
    "You write the overview a developer sees first when opening an unfamiliar repository. You're given the summaries of its top-level folders and files.",
    "Give a tagline of at most 6 words and a summary of 2 to 4 sentences.",
    "The summary says what the project is, names its main areas, and says where a newcomer should start reading.",
    "Don't guess beyond the summaries you're given.",
].join("\n");

/** One child of a folder, as its prompt shows it. lineCount is a folder's total, used only for ordering. */
export type FolderItem = { name: string; kind: "file" | "folder"; fileCount: number; lineCount: number; text: SummaryText | null };

/** "1 line", "9 lines", "12,103 files". */
export function plural(n: number, word: string): string {
    return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * A file's prompt: the imports/exports listing chunks.ts generates (it opens with
 * "File: <path>"), the line count, then the source, cut to about 6k tokens.
 */
export function renderFilePrompt(listing: string, lineCount: number, source: string, maxChars: number = MAX_SOURCE_CHARS): string {
    return [listing, "", `Lines: ${lineCount}`, "", "Source:", truncateSource(source, maxChars)].join("\n");
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
