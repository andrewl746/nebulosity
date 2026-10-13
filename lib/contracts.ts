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
 *  - Types only. No functions, no logic, no runtime values (the one
 *    exception: CONTRACTS_VERSION).
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
export const CONTRACTS_VERSION = 2;

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

export type MapNodeKind = "folder" | "file" | "more";

/** One box on the Map — docs/API_CONTRACTS.md §11 */
export type MapNode = {
  /** Repo-relative. The "+N more" box uses its level's path plus "/" ("/" at the root), which no real path can be. */
  path: string;
  /** "workbench", "lifecycle.ts" or "+12 more". */
  name: string;
  kind: MapNodeKind;
  /** Source files inside: 1 for a file; for "+N more", the folded boxes' total. */
  fileCount: number;
  tagline?: string;
  /** "skipped" for the "+N more" box, which has no summary of its own. */
  summaryStatus: SummaryStatus;
  /** "+N more" only: how many boxes it stands for. */
  hiddenCount?: number;
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
  /** At most 50 boxes, largest first; "+N more", if any, last. */
  nodes: MapNode[];
  edges: MapEdge[];
  /** How many children "+N more" stands for (0 when everything fits). */
  hiddenCount: number;
  /** Which page of the folder's boxes this is, from 0, and how many there are (1 when everything fits). Added in V1.3.1. */
  page: number;
  pageCount: number;
  /** Moves whenever anything the Map shows changes: refetch when it does. */
  indexVersion: number;
};


/** A declaration in a file: top-level ones and class members (`Logger.info`), with the lines to jump to. */
export type SymbolInfo = { name: string; kind: string; startLine: number; endLine: number; exported: boolean };

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
  stats: { fileCount: number; lineCount: number };
  /** Folders and the repo: every child, in the Map's order (so the boxes "+N more" folds are the ones after the first 49). */
  children?: MapNode[];
  /** Files: their declarations, in line order. */
  symbols?: SymbolInfo[];
  /** What the target imports, by area, most first. */
  uses: AreaCount[];
  /** What imports the target, by area, most first. */
  usedBy: AreaCount[];
  /** Files at or under the target whose summary is out of date with their bytes. */
  stalePaths: number;
  indexVersion: number;
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

/** GET /api/repos — docs/API_CONTRACTS.md §15 */
export type RepoList = { active: string | null; repos: RepoSummary[] };

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
    /** Files left out (over 1 MB, unreadable). */
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

/** The three ranked lists hybrid search fuses (ADR-027). */
export type SearchList = "code" | "summary" | "vector";

/** One file or folder in a search result — docs/API_CONTRACTS.md §10 */
export type SearchHit = {
  path: string;
  kind: "file" | "folder";
  /** Reciprocal Rank Fusion: Σ 1 / (60 + rank) over the lists that found it. */
  score: number;
  matchedBy: SearchList[];
  tagline?: string;
  summary?: string;
  /** The best-matching chunk, when the code list found this file. */
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

/* ──────────────────────────── Persistence ────────────────────────── */

/**
 * Persistence shapes live in lib/db/schema.ts (SQLite via Drizzle, ADR-013), not here. This file owns API and domain
 * types only. The database evolves through Drizzle migrations (lib/db/migrations), never through CONTRACTS_VERSION.
 */
