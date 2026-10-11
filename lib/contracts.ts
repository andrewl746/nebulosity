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
 *  - Importable from anywhere (core, adapters, UI). May import types from
 *    npm packages, never from app/.
 *  - Node ids, chunk file paths, tool arguments, and source citations are
 *    ALL project-relative forward-slash paths ("lib/graph.ts"). One shared
 *    identifier is what lets every subsystem point at the same things.
 */

import type { Node, Edge } from "@xyflow/react";

/** Bump on breaking contract changes; mismatch tells storage to rebuild. */
export const CONTRACTS_VERSION = 1;

/* ────────────────────────────── Graph ────────────────────────────── */

/** Semantic class of a file node — decides the indicator dot color. */
export type FileKind = "component" | "module";

/** Payload carried by every graph node (rendered by app/components/FileNode.tsx). */
export type FileNodeData = {
  fileName: string; // "graph.ts"
  dir: string;      // "lib" ("" for root-level files)
  kind: FileKind;
};

/**
 * Canonical React Flow node shape for a file.
 * Phase 1 migrates FileNode.tsx and lib/graph.ts to import this type
 * (they currently declare a structurally-identical local copy).
 */
export type GraphFileNode = Node<FileNodeData, "file">;

/** GET /api/graph — docs/API_CONTRACTS.md §2 */
export type GraphResponse = {
  nodes: GraphFileNode[];
  edges: Edge[];
  stats: {
    fileCount: number;
    edgeCount: number;
    rootName: string;
    warningCount: number;
    /** Top 5 by degree centrality (ADR-010). */
    centralFiles: { path: string; inDegree: number; outDegree: number }[];
  };
};

/* ────────────────────────────── Health ───────────────────────────── */

/** GET /api/health — docs/API_CONTRACTS.md §3 */
export type HealthResponse = {
  ok: true;
  /** ISO timestamp of the repo's last dependency-graph scan (DB-backed, Phase D); null if never scanned. */
  lastScanAt: string | null;
  index: {
    exists: boolean;
    indexedAt: string | null; // ISO timestamp
    chunkCount: number;
    staleFiles: number; // files whose contentHash differs from disk (0 = fresh)
  };
  /** Which scan engine will serve the next scan (ADR-014). */
  scannerEngine: "native" | "node";
  agentReady: boolean; // ANTHROPIC_API_KEY present (never echo the key)
};

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
};

/* ─────────────────────────── Error envelope ──────────────────────── */

export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "INDEX_EMPTY"
  | "INDEX_LOCKED"
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

export type IndexPhase = "scanning" | "chunking" | "embedding";

/** POST /api/index SSE events — docs/API_CONTRACTS.md §4 */
export type IndexEventMap = {
  progress: {
    phase: IndexPhase;
    done: number;
    total: number;
    currentFile?: string;
  };
  done: {
    fileCount: number;
    chunkCount: number;
    skippedUnchanged: number;
    tookMs: number;
    /** Files re-chunked and re-embedded this run. */
    changed: number;
    /**
     * Per-file failures. Indexing is per-file error-tolerant, so a run can
     * succeed overall while individual files failed — without this the caller
     * cannot tell the difference (ADR-021).
     */
    errors: Array<{ path: string; error: string }>;
    /** Unreadable files/directories reported by the scanner (F2). */
    warnings: Array<{ path: string; error: string }>;
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

export type RetrievedChunk = CodeChunk & { score: number };

/** GET /api/search response — docs/API_CONTRACTS.md §6 */
export type SearchResponse = { results: RetrievedChunk[] };

/* ──────────────────────────── Persistence ────────────────────────── */

/**
 * Persistence shapes live in lib/db/schema.ts (SQLite via Drizzle, ADR-013),
 * not here. This file owns API and domain types only. CONTRACTS_VERSION is
 * stored in the database's `meta` table as schemaVersion — a mismatch at
 * startup means derived data must be wiped and rebuilt
 * (docs/DATABASE_DESIGN.md §2, §5).
 */
