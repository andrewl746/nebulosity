import type { Importer, SummaryText } from "../../db/store/summaries";
import { childToward, lcaFolder } from "../aggregate";
import { countLines } from "../languages/typescript";
import { dirOf } from "../paths";

/** Part of every inputHash. Bump it to redo every summary on purpose (a better prompt, new settings). Version 2: ADR-034. */
export const PROMPT_VERSION = 2;

/**
 * Who writes what by default (ADR-028): Haiku for the many files, Sonnet for the folders and the repo people read first.
 * summaryModels in config.json overrides any kind (ADR-066); every reader takes the models resolved from it (models.ts).
 */
export const SUMMARY_MODELS = {
    file: "claude-haiku-5-5",
    folder: "claude-sonnet-5-5",
    repo: "claude-sonnet-5-5",
} as const;

/** Summaries are short and factual, so low effort keeps thinking (and cost) small. Tunable (PIVOT_SPEC.md §5.3). */
export const SUMMARY_EFFORT = "low" as const;

/** Room for the reply plus whatever thinking low effort does. Unused tokens cost nothing. */
export const MAX_OUTPUT_TOKENS = 4096;

/**
 * The one retry's limit when an answer came back cut off (ADR-034). Review #3's cut-off summary had stopped normally
 * at about 280 output tokens, so the limit wasn't the cause there; but a reply that did hit the limit is cut off
 * whatever its text says, and asking again at the same limit could only hit it again. Doubling it removes that one
 * known cause and costs nothing when unused.
 */
export const RETRY_MAX_OUTPUT_TOKENS = 8192;

/** About 6k tokens of source (PIVOT_SPEC.md §5.3): code runs roughly 3.5 characters per token. */
export const MAX_SOURCE_CHARS = 20_000;

/** A folder's prompt lists at most this many of its children, largest first. */
export const MAX_FOLDER_ITEMS = 50;

/** A file's prompt names this many of the areas its importers sit in (PIVOT_SPEC.md §4.2's groups); the rest fold into a count. */
export const MAX_IMPORTER_GROUPS = 3;

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
 * "File: <path>"), the line count, who imports the file (the line importerLine renders),
 * then the source, cut to about 6k tokens.
 */
export function renderFilePrompt(
    listing: string,
    lineCount: number,
    importedBy: string,
    source: string,
    maxChars: number = MAX_SOURCE_CHARS
): string {
    return [listing, "", `Lines: ${lineCount}`, importedBy, "", "Source:", truncateSource(source, maxChars)].join("\n");
}

/**
 * How widely, and where, a file is used, from the import graph: a source file can't say who imports it, so
 * the model is told. Importers are grouped by area with the rule the Map uses for its level edges
 * (PIVOT_SPEC.md §4.2): an importer's group is the child of the lowest common folder of the two files
 * toward the importer, or the importer itself when it sits directly in that folder. A central file's
 * importers then read as the areas that use it ("src/vs/workbench"), not as the biggest leaf folders, which
 * named arbitrary deep folders. Test files are counted apart and tallied last (", plus 2 test files"): on a
 * central file they would skew how its use looks. The total, the groups and the examples come from the other
 * importers: counted per group, biggest first (ties by path, compared with plain `<` so the order never
 * depends on a locale and the same graph always gives the same line), with the first maxGroups named and the
 * files in the rest folded into a count.
 */
export function importerLine(filePath: string, importers: readonly Importer[], maxGroups: number = MAX_IMPORTER_GROUPS): string {
    if (importers.length === 0) return "Imported by: no other indexed file";

    const nonTests = importers.filter((importer) => !importer.isTest);
    const tests = importers.length - nonTests.length;
    if (nonTests.length === 0) return `Imported by: only ${plural(tests, "test file")}`;

    const folder = dirOf(filePath);
    const perGroup = new Map<string, number>();
    for (const { path } of nonTests){
        const group = childToward(lcaFolder(folder, dirOf(path)), path);
        perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
    }

    const ranked = [...perGroup].sort(([groupA, countA], [groupB, countB]) =>
        countB - countA || (groupA < groupB ? -1 : groupA > groupB ? 1 : 0));
    // At least one group is always named: with none, the line would read "Imported by: 3 files: , and 3 files elsewhere".
    const limit = Math.max(1, maxGroups);
    const shown = ranked.slice(0, limit);
    // Counts are written the way plural() writes the total, so a central file reads "3,066 files: src/vs/workbench (1,840), ...".
    const named = shown.map(([group, count]) => `${group} (${count.toLocaleString("en-US")})`);

    let line = `Imported by: ${plural(nonTests.length, "file")}: ${named.join(", ")}`;
    if (ranked.length > limit){
        const rest = nonTests.length - shown.reduce((sum, [, count]) => sum + count, 0);
        line += `, and ${plural(rest, "file")} elsewhere`;
    }
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

/**
 * The other languages' test-file names (E4, C9), one row per merged language, matching its rules' isTest: the
 * extension, the marker the name's stem loses (`test_views.py` → views, `server_test.go` → server, `OrderIT.java` →
 * Order, `OrderTests.cs` → Order), and the stems that stand for their folder: a file that is only a marker (`tests.py`, `tests.rs`), pytest's
 * per-folder `conftest.py`, and a module's own file (`__init__.py`, `mod.rs`), so `tests/admin_views/tests.py` tests
 * admin_views. A `src` folder names nothing: `crates/hir-ty/src/tests.rs` tests hir-ty. TypeScript's and JavaScript's
 * names keep their own rule, unchanged.
 */
const TEST_NAMES: readonly { extension: RegExp; marker: RegExp; folder?: RegExp }[] = [
    { extension: /\.pyi?$/, marker: /^test_|_test$/, folder: /^(tests|conftest|__init__)$/ },
    { extension: /\.go$/, marker: /_test$/ },
    { extension: /\.java$/, marker: /(Test|Tests|IT|TestCase)$/ },
    { extension: /\.cs$/, marker: /Tests?$/ },
    { extension: /\.rs$/, marker: /_tests?$/, folder: /^(tests|mod)$/ },
];

/** What a test file tests, from its path: its name without its language's extension and test marker. */
function testSubject(filePath: string): string {
    const slash = filePath.lastIndexOf("/");
    const base = filePath.slice(slash + 1);
    const names = TEST_NAMES.find((n) => n.extension.test(base));
    if (!names) return base.replace(/\.(test|spec)(?=\.[cm]?[jt]sx?$)/, "").replace(/\.[cm]?[jt]sx?$/, "");
    const stem = base.replace(names.extension, "");
    const subject = stem.replace(names.marker, "");
    const folder = filePath.split("/").slice(0, -1).filter((segment) => segment !== "src").at(-1) ?? "";
    // nothing left, or a name that stands for its folder: the folder's name, when there is one
    if ((subject === "" || names.folder?.test(stem)) && folder !== "") return folder;
    return subject || stem;
}

/** Test files skip the model (PIVOT_SPEC.md §5.3). This template says what they are from the path alone. */
export function testFileSummary(filePath: string, lineCount: number): SummaryText {
    const subject = testSubject(filePath);
    return {
        tagline: `Tests for ${subject}`,
        summary: `Test code (${plural(lineCount, "line")}) for ${subject}. Test files get this template instead of a model-written summary.`,
    };
}

/**
 * A file over the size cap is indexed for its imports only (ADR-053): almost always generated or bundled code, so it
 * skips the model as a test file does. "1 MB" for the default cap, "1,000-byte" for a cap that isn't whole megabytes.
 */
export function importsOnlyFileSummary(lineCount: number, maxFileBytes: number): SummaryText {
    const cap = maxFileBytes % 1_000_000 === 0 ? `${maxFileBytes / 1_000_000} MB` : `${maxFileBytes.toLocaleString("en-US")}-byte`;
    return {
        tagline: "Over the size cap: imports only",
        summary: `Too large to read in full (${plural(lineCount, "line")}, over the ${cap} size cap): only its imports are indexed. `
            + "Files over the cap get this template instead of a model-written summary.",
    };
}

/**
 * Folders that hold only test files skip the model too (PIVOT_SPEC.md §5.3). The subject is the area the
 * tests cover: the segment just before the first test/tests/__tests__ segment ("folding" for
 * ".../folding/test/browser"). A top-level test folder covers the whole repo, so it takes the repo's name
 * ("Tests for vscode", not "Tests for test"); anything else takes the folder's own name.
 */
export function testFolderSummary(folderPath: string, testFileCount: number, repoName: string): SummaryText {
    const segments = folderPath.split("/");
    const at = segments.findIndex((segment) => segment === "test" || segment === "tests" || segment === "__tests__");
    const subject = at > 0 ? segments[at - 1] : at === 0 && segments.length === 1 ? repoName : segments[segments.length - 1];
    return {
        tagline: `Tests for ${subject}`,
        summary: `Test code (${plural(testFileCount, "test file")}) for ${subject}. Test-only folders get this template instead of a model-written summary.`,
    };
}
