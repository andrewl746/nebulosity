import type { ErrorEnvelope, IndexEventMap, SummarizeResponse } from "../contracts";

/** Server → worker over the IPC channel (ADR-038). Requests carry an id, and the answer carries it back. */
export type ParentMessage =
    | { type: "repo"; root: string | null }
    // each request names the repo it's for: the worker refuses one meant for a repo it isn't on (C1)
    | { type: "summarize"; id: number; path: string; root: string }
    | { type: "index"; id: number; root: string };

/** A request that couldn't be done, with the code and message the API shows. */
export type ApiFailure = { ok: false; error: ErrorEnvelope["error"] };
export type SummarizeOutcome = { ok: true; summary: SummarizeResponse } | ApiFailure;
export type IndexOutcome = { ok: true; result: IndexEventMap["done"] } | ApiFailure;

/** Worker → server. "ready" follows each "repo" message: the worker is up and watching. */
export type ChildMessage =
    | { type: "ready" }
    | { type: "summarized"; id: number; outcome: SummarizeOutcome }
    | { type: "index-progress"; id: number; progress: IndexEventMap["progress"] }
    | { type: "indexed"; id: number; outcome: IndexOutcome };
