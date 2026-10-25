/**
 * lib/contracts.ts — single source of truth for every shape shared between
 * the UI, the API adapters, and core services.
 *
 * This file is the compiler-enforced version of docs/API_CONTRACTS.md (and
 * the storage schemas in docs/DATABASE_DESIGN.md). If this file and those
 * docs ever disagree, fix the drift in the same commit — see the maintenance
 * rule in docs/ARCHITECTURE.md.
 *
 * Rules:
 *  - Types only. No functions, no logic, no runtime values (the exceptions:
 *    the version numbers CONTRACTS_VERSION, DEMO_FORMAT_VERSION and BRIDGE_VERSION).
 *  - Importable from anywhere (core, adapters, UI). Never imports from app/,
 *    and never a renderer's types: the UI maps these shapes onto React Flow
 *    itself (ADR-040).
 *  - Node ids, file and folder paths, tool arguments, and source citations
 *    are ALL repo-relative forward-slash paths ("src/vs/base/common/lifecycle.ts",
 *    "" for the repo root). One shared identifier is what lets every subsystem
 *    point at the same things.
 */

/**
 * The API contract's version (ADR-040): bumped on a breaking change to these
 * shapes. Stored data changes only through Drizzle migrations; nothing wipes
 * the database when this moves.
 */
export const CONTRACTS_VERSION = 3;

/** The editor bridge's version (docs/API_CONTRACTS.md §20): the `version` of its hello and ready, and `server.bridge` of GET /api/repos. */
export const BRIDGE_VERSION = 1;

/* ─────────────────────────── Index status ────────────────────────── */

/** The stages a repo goes through (PIVOT_SPEC.md §5). E2, E3 and E5 add more. */
export type StageName = "structure" | "summaries" | "embeddings";

/** idle: never ran · running · ready: done and current · off: can't run (e.g. no API key) · failed */
export type StageState = "idle" | "running" | "ready" | "off" | "failed";

export type StageStatus = { state: StageState; done: number; total: number; note?: string };

/** GET /api/status — docs/API_CONTRACTS.md §9 */
export type IndexStatus = {
  /** The repo's root: absolute, forward slashes (repositories.rootPath). */
  repo: string;
  stages: Record<StageName, StageStatus>;
  /** Moves whenever anything the Map shows changes (API_CONTRACTS.md §11). */
  indexVersion: number;
};

/* ─────────────────────────────── Map ─────────────────────────────── */

/**
 * A summary as the UI reports it: the stored statuses (fresh, stale, pending, failed, skipped) plus "off", which is
 * never stored: there's no API key, so a summary that doesn't exist yet can't be written.
 */
export type SummaryStatus = "fresh" | "stale" | "pending" | "failed" | "skipped" | "off";

export type MapNodeKind = "folder" | "file" | "portal";

/** One box on the Map — docs/API_CONTRACTS.md §11 */
export type MapNode = {
  /**
   * Repo-relative. A portal (a doorway to another page of a big folder) uses "<level>//page-<n>" or "<level>//pages",
   * which no stored path can be: stored paths never hold "//".
   */
  path: string;
  /** "workbench", "lifecycle.ts", or a portal's "Page 2" / "+3 pages". */
  name: string;
  kind: MapNodeKind;
  /** Source files inside: 1 for a file; for a portal, the total of the boxes behind it. */
  fileCount: number;
  tagline?: string;
  /** "skipped" for a portal, which has no summary of its own. */
  summaryStatus: SummaryStatus;
  /** Portals: how many boxes they stand for. */
  hiddenCount?: number;
  /** A portal to one other page: that page, from 0. Its path is "<level>//page-<page + 1>" (API_CONTRACTS.md §11). */
  page?: number;
  /** The merged portal ("+N pages", path "<level>//pages"): the pages it stands for, from 0, ascending. */
  pages?: number[];
  /** Portals: the paths of the boxes on the page(s) behind them, in the Map's order, so a path can find its doorway. */
  members?: string[];
};

/** Imports from one box to another at one level, each import counted once (PIVOT_SPEC.md §4.2). */
export type MapEdge = { source: string; target: string; count: number };

/** Imports across a target's boundary, grouped by the area on the other side (PIVOT_SPEC.md §4.2). */
export type AreaCount = { path: string; kind: "folder" | "file"; count: number };

/** GET /api/level — docs/API_CONTRACTS.md §11 */
export type LevelResponse = {
  /** The repo's root: absolute, forward slashes. */
  repo: string;
  /** The folder on screen; "" is the repo root. */
  path: string;
  /** Folder paths from the root down to `path`: ["", "src", "src/vs"]. */
  breadcrumb: string[];
  /** At most 50 boxes: this page's, in the Map's order (largest first), then its portals, if any. */
  nodes: MapNode[];
  /** Lines between the boxes; one end on another page is folded onto that page's portal. */
  edges: MapEdge[];
  /** How many of the folder's boxes are on other pages (0 when everything fits). */
  hiddenCount: number;
  /** Which page of the folder's boxes this is, from 0, and how many there are (1 when everything fits). Added in V1.3.1. */
  page: number;
  pageCount: number;
  /** Moves whenever anything the Map shows changes: refetch when it does. */
  indexVersion: number;
};


/** A declaration in a file: top-level ones and class members (`Logger.info`), with the lines to jump to. */
export type SymbolInfo = { name: string; kind: string; startLine: number; endLine: number; exported: boolean };

/** A doc linked to a place (ADR-054), and why. describe always says why; overview says it for a doc that applies to a folder. */
export type DocPointer = {
  path: string;
  title: string;
  reason?: { kind: "applies" | "readme" | "mentions"; target: string; detail?: string; count: number };
};

/** GET /api/describe — docs/API_CONTRACTS.md §12 */
export type DescribeResponse = {
  /** The repo's root: absolute, forward slashes (for vscode:// links). */
  repo: string;
  path: string;
  kind: "repo" | "folder" | "file";
  tagline?: string;
  summary?: string;
  summaryStatus: SummaryStatus;
  /** Why the last attempt failed, when summaryStatus is "failed". */
  summaryError?: string;
  /** For a folder or file, the docs linked to it or the folders above it; for the repo, the docs to read first (ADR-054). Left out when none. */
  docs?: DocPointer[];
  stats: { fileCount: number; lineCount: number };
  /** Folders and the repo: every child, in the Map's order (the order level() draws them in, page by page). */
  children?: MapNode[];
  /** Files: their declarations, in line order. */
  symbols?: SymbolInfo[];
  /** A file over the 1 MB size cap: indexed for its imports only, so `symbols` is empty because they weren't read (ADR-053). */
  importsOnly?: true;
  /** What the target imports, by area, most first. */
  uses: AreaCount[];
  /** What imports the target, by area, most first. */
  usedBy: AreaCount[];
  /** Files at or under the target whose summary is out of date with their bytes. */
  stalePaths: number;
  indexVersion: number;
};

/**
 * GET /api/imports — docs/API_CONTRACTS.md §19 (added in V1.8): one page of the files that import a file or folder, or that it
 * imports, nearest first. `total` counts every page (after `transitive`), `direct` the distance-1 files whatever `transitive` is.
 */
export type ImportsResponse = {
  path: string;
  kind: "folder" | "file";
  direction: "dependents" | "dependencies";
  transitive: boolean;
  files: { path: string; distance: number }[];
  direct: number;
  total: number;
  offset: number;
  indexVersion: number;
};

/** GET /api/source — docs/API_CONTRACTS.md §16 (added in V1.3.1): an indexed file's text, for the source viewer. */
export type SourceResponse = {
  /** The repo's root: absolute, forward slashes. */
  repo: string;
  path: string;
  content: string;
  /** Lines in `content`, as an editor counts them. */
  lineCount: number;
  /** The file was longer than the limit (1 MB) and `content` stops there. */
  truncated: boolean;
  /** "typescript", "javascript", "python", "go", "java", "csharp", "rust" (E4, ADR-065), or "text". */
  language: string;
};

/** POST /api/summarize — docs/API_CONTRACTS.md §13 */
export type SummarizeResponse = {
  path: string;
  kind: "repo" | "folder" | "file";
  tagline?: string;
  summary?: string;
  summaryStatus: SummaryStatus;
  /** Why it failed, when summaryStatus is "failed". */
  summaryError?: string;
};

/** Where a repo was cloned from: its origin remote's owner and name ("microsoft" / "vscode") — docs/API_CONTRACTS.md §15 */
export type RepoRemote = { owner: string; name: string };

/** One repo the Map can show — docs/API_CONTRACTS.md §15 */
export type RepoSummary = {
  root: string;
  name: string;
  indexedAt: string | null;
  /** The origin remote, when the repo has one the top bar can show as "owner / repo" (added in V1.3.1). */
  remote?: RepoRemote;
};

/** The server itself, on GET /api/repos — docs/API_CONTRACTS.md §15: the package's version and the editor bridge's. */
export type ServerInfo = { version: string; bridge: number };

/** GET /api/repos — docs/API_CONTRACTS.md §15. `server` is on GET's answer (added in V1.8), not on POST's. */
export type RepoList = { active: string | null; repos: RepoSummary[]; server?: ServerInfo };

/**
 * Messages from the VS Code extension's webview to the Map, which is framed in it with `?embed=vscode` —
 * docs/API_CONTRACTS.md §20 (added in V1.8). They travel by window.postMessage. Paths are repo-relative.
 */
export type BridgeToMap =
  | { type: "nebulosity.hello"; version: 1 }
  /** The active editor changed: focus on the path, replacing the history entry. */
  | { type: "nebulosity.follow"; path: string }
  /** A deliberate jump: focus on the path, pushing a history entry. */
  | { type: "nebulosity.show"; path: string }
  | { type: "nebulosity.highlight"; paths: string[] }
  | { type: "nebulosity.clear" };

/** Messages from the Map to the webview — docs/API_CONTRACTS.md §20. */
export type BridgeFromMap =
  /** The answer to hello. */
  | { type: "nebulosity.ready"; version: 1 }
  /** A file box or a declaration was picked. */
  | { type: "nebulosity.open"; path: string; line?: number }
  /** A new level was drawn, the selection changed on the level drawn, or a `ready` was answered while a level is on screen (the extension's test and benchmarks read it). */
  | { type: "nebulosity.drawn"; path: string; page: number; selected: string | null };

/* ─────────────────────────── Error envelope ──────────────────────── */

export type ErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INDEX_EMPTY"
  | "INDEX_LOCKED"
  | "NOT_READY"
  | "SUMMARIES_OFF"
  | "BUDGET_EXCEEDED"
  | "UPSTREAM"
  | "INTERNAL";

/** Non-SSE error responses — docs/API_CONTRACTS.md §1 */
export type ErrorEnvelope = {
  error: { code: ErrorCode; message: string };
};

/* ──────────────────────────── UI actions ─────────────────────────── */

/**
 * Commands the agent sends to the graph canvas (ADR-008).
 * nodeIds are graph node ids, i.e. project-relative file paths.
 */
export type UIAction =
  | { type: "highlight_nodes"; nodeIds: string[] }
  | { type: "focus_node"; nodeId: string }
  | { type: "clear_highlights" };

/* ─────────────────────────────── Live ────────────────────────────── */

/**
 * A tool call to show on the open Maps (PIVOT_SPEC.md §8) — docs/API_CONTRACTS.md §14. The boxes holding `paths`
 * pulse; an `action` (show_on_map's) also highlights, focuses or clears. Node ids may be folders as well as files.
 */
export type LiveEvent = { tool: string; paths: string[]; at: string; action?: UIAction };

/** GET /api/live/stream's SSE events — docs/API_CONTRACTS.md §14 */
export type LiveStreamEventMap = {
  ready: Record<string, never>;
  tool: LiveEvent;
};

/* ───────────────────────────── Chat (SSE) ────────────────────────── */

/** POST /api/chat request body — docs/API_CONTRACTS.md §5 */
export type ChatRequest = {
  sessionId: string; // client-generated UUID, stable across turns = memory
  message: string;
};

/**
 * Every SSE event name and its payload, exhaustively.
 * The stream always terminates with `done` (success or failure).
 */
export type ChatEventMap = {
  token: { text: string };
  tool_start: { tool: string; args: Record<string, unknown> };
  tool_end: { tool: string };
  ui_action: { action: UIAction };
  sources: { files: string[] };
  error: { code: ErrorCode; message: string };
  done: Record<string, never>; // {}
};

export type ChatEventName = keyof ChatEventMap;

/** A parsed SSE frame from /api/chat, as the client's stream reader yields it. */
export type ChatEvent = {
  [K in ChatEventName]: { event: K; data: ChatEventMap[K] };
}[ChatEventName];

/* ─────────────────────────── Indexing (SSE) ──────────────────────── */

/** The structure stage's steps, in order (PIVOT_SPEC.md §5.2). */
export type IndexStage = "discover" | "parse" | "write" | "resolve" | "aggregate";

/** POST /api/index SSE events — docs/API_CONTRACTS.md §4 */
export type IndexEventMap = {
  progress: { stage: IndexStage; done: number; total: number };
  done: {
    files: number;
    changed: number;
    deleted: number;
    edges: number;
    folders: number;
    levelEdges: number;
    /** Per-file failures: indexing is per-file error-tolerant (ADR-021). */
    errors: Array<{ path: string; error: string }>;
    /**
     * Files whose parse threw, read by the scan instead: indexed for their imports only, each with the parse's error
     * (ADR-065, the E4 final review's B-I1). Additive and optional (CONTRACTS_VERSION stays 3); the worker always sends it.
     */
    scanned?: Array<{ path: string; error: string }>;
    /**
     * Files left out: code files over 20 MB, docs over 1 MB, and files that couldn't be read. A code file over 1 MB is
     * indexed for its imports only (ADR-053).
     */
    skipped: number;
    totalMs: number;
  };
  error: { code: ErrorCode; message: string };
};

export type IndexEvent = {
  [K in keyof IndexEventMap]: { event: K; data: IndexEventMap[K] };
}[keyof IndexEventMap];

/* ─────────────────────────── RAG: chunks ─────────────────────────── */

export type ChunkKind =
  | "function"
  | "class"
  | "component"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "namespace"
  | "file-summary";

/** One retrievable unit of code — docs/RAG_PIPELINE.md §3 */
export type CodeChunk = {
  /**
   * `${filePath}#${name}#${partIndex}` — stable across runs for unchanged files.
   *
   * When one file declares the same name more than once (overload signatures,
   * declaration merging), the second and later occurrences get a `~n`
   * disambiguator on the name segment — `lib/x.ts#foo~2#0` — so ids stay
   * unique without the display `name` changing. See ADR-019.
   */
  id: string;
  filePath: string; // project-relative, forward slashes
  kind: ChunkKind;
  name: string;     // "toFlowGraph", or "(file)" for file-summary chunks
  /**
   * 1-based, inclusive. The span covers the declaration *and* its attached
   * leading comment block — `startLine`, `endLine` and `text` always describe
   * exactly the same region (ADR-018).
   */
  startLine: number;
  endLine: number;   // 1-based, inclusive
  exported: boolean;
  /** 0-based index of this part; 0 when the declaration was not split. */
  partIndex: number;
  text: string;      // exact source text of the chunk
  fileHash: string;  // sha256 of the whole source file at index time
};

/* ───────────────────────────── Search ────────────────────────────── */

/** The ranked lists hybrid search fuses (ADR-027): code, summaries, meaning, folder names (since V1.3.1) and file names (since V1.5). */
export type SearchList = "code" | "summary" | "vector" | "name" | "file";

/** One file or folder in a search result — docs/API_CONTRACTS.md §10 */
export type SearchHit = {
  path: string;
  kind: "file" | "folder";
  /** Weighted Reciprocal Rank Fusion: Σ w / (60 + rank) over the lists that found it (w = 2 for "name" and "file", else 1). */
  score: number;
  matchedBy: SearchList[];
  tagline?: string;
  summary?: string;
  /** The best-matching chunk, when the code list found this file: a declaration when one matched, else the imports listing ("(file)") with its header removed. */
  code?: { symbol: string; startLine: number; endLine: number; snippet: string };
};

/** What search(query) returns — docs/API_CONTRACTS.md §10 */
export type SearchResult = {
  query: string;
  hits: SearchHit[];
  /** How many files or folders each list contributed before fusion. */
  lists: Record<SearchList, number>;
  /** Set when something limits the results, e.g. no summaries yet. */
  note?: string;
};

/* ───────────────────────── The static demo ───────────────────────── */

/**
 * The static demo's files (API_CONTRACTS.md §18, ADR-049): written by scripts/export-demo.ts, read by
 * app/map/staticApi.ts. Every answer in them names the repo by its public name, never its absolute root.
 */

/** Bumped on any change to the files below; the demo's page refuses data of another format. */
export const DEMO_FORMAT_VERSION = 1;

/** manifest.json: what the demo shows, and the folder ids every other file is named by. */
export type DemoManifest = {
  format: number;
  /** The repo's public name ("vscode"), standing in for its root wherever an answer names the repo. */
  repo: string;
  remote?: RepoRemote;
  /** The commit the index was built from; source links point at it. Null outside git. */
  commit: string | null;
  exportedAt: string;
  status: IndexStatus;
  /** Every folder, in path order; a folder's id is its position ("" is the root, id 0). */
  folders: string[];
  /** Page counts by folder id, for folders drawn on more than one page. */
  pages: Record<string, number>;
};

/** pages/<id>.json: the boxes on each page of a paged folder, page by page. */
export type DemoPageIndex = { boxes: string[][] };

/** describe/<id>.json: describe answers for a folder and for each file directly inside it, by path. */
export type DemoDescribeBundle = Record<string, DescribeResponse>;

/** search.json: what the demo's search ranks (lib/engine/staticSearch.ts). */
export type DemoSearchIndex = {
  /** [kind (1 folder, 0 file), path, tagline, summary] for every file and folder with a summary; never the repo. */
  summaries: [number, string, string, string][];
  /** [path, fileCount] for every folder but the root. */
  folders: [string, number][];
  /** [path, importedBy, isTest (1 or 0)] for every file, in path order. */
  files: [string, number, number][];
  /** [name, position in files] for every exported top-level declaration, by file, then line. */
  declarations: [string, number][];
};

/* ──────────────────────── The settings file ──────────────────────── */

/**
 * One kind's entry under `summaryModels` in config.json — docs/API_CONTRACTS.md §21 (ADR-066): the model that writes
 * that kind's summaries, and its list prices in US dollars per million tokens. The prices may be left out only for a
 * model the built-in price table has; given prices win over the table's.
 */
export type SummaryModelSetting = { model: string; inputPerMTok?: number; outputPerMTok?: number };

/** `summaryModels` in config.json — docs/API_CONTRACTS.md §21. A kind left out keeps its default model (ADR-028). */
export type SummaryModelsSetting = Partial<Record<"file" | "folder" | "repo", SummaryModelSetting>>;

/* ──────────────────────────── Persistence ────────────────────────── */

/**
 * Persistence shapes live in lib/db/schema.ts (SQLite via Drizzle, ADR-013), not here. This file owns API and domain
 * types only. The database evolves through Drizzle migrations (lib/db/migrations), never through CONTRACTS_VERSION.
 */
