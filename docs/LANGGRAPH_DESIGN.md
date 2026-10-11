# LANGGRAPH_DESIGN.md — Agent Orchestration

> **2026-10-11 — pivot:** still valid as the orchestration design for extra E1 (the Guide). Tools now come from the shared registry (ADR-030), and the model choice is revisited when E1 starts.

**Status:** Approved design
**Implements:** Phase 5 of `IMPLEMENTATION_ROADMAP.md` (machinery layer)
**Companion doc:** `AI_AGENT_DESIGN.md` (what the agent does); this doc covers *how the loop runs*.
**Packages (pin these):** `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/core`, `zod`

---

## 1. Why LangGraph (one paragraph for the learner)

An agent is fundamentally a loop: *ask the LLM → if it requested tools, run them and loop; otherwise return the answer*. You could write that as a `while` loop in 30 lines. LangGraph makes the loop an **explicit state machine**: state is a typed object, each step is a named node, and transitions are declared edges. The payoff is inspectability (you can log every state transition), built-in conversation memory (checkpointers keyed by thread), native streaming of every internal event, and a structure that survives growing complexity (adding a summarize node or a human-approval gate later means adding a node, not rewriting a loop).

---

## 2. State schema

`lib/agent/state.ts`:

```ts
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { UIAction } from "@/lib/contracts";

export const AgentState = Annotation.Root({
  // Full conversation: Human/AI/Tool messages. The built-in reducer
  // appends new messages and merges by id — never overwrite this manually.
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // UI actions emitted this turn (highlight/focus/clear). Append-reducer;
  // the adapter drains them into SSE events. Reset at the start of each turn.
  uiActions: Annotation<UIAction[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),

  // File paths cited via retrieval/reads this turn — deduped union.
  // Streamed to the client as the `sources` event for source chips.
  sources: Annotation<string[]>({
    reducer: (prev, next) => [...new Set([...prev, ...next])],
    default: () => [],
  }),
});
```

**Design rule:** state carries *facts about the turn*, not derived prose. Anything the UI needs (actions, sources) rides in state so the adapter can emit it without parsing model text.

## 3. Graph topology

```
            START
              │
              ▼
        ┌──────────┐
        │  agent   │  ChatAnthropic (claude-sonnet-5) with tools bound
        └────┬─────┘
             │  shouldContinue(state)
      ┌──────┴────────┐
 tool calls?          no tool calls
      │                     │
      ▼                     ▼
 ┌──────────┐              END   (final AI message is the answer)
 │  tools   │  ToolNode: executes every tool call in the last AI message,
 └────┬─────┘  appends ToolMessages to state.messages
      │
      └────────► agent   (loop)
```

- **agent node:** one function. Builds the system prompt (once per thread via `prompts.ts`), calls `model.bindTools(allTools)`, invokes with `state.messages`, returns `{ messages: [response] }`.
- **tools node:** LangGraph's prebuilt `ToolNode` over the registry from `lib/agent/tools.ts`. UI-action tools additionally return their `UIAction` payload, which the agent-graph wrapper copies into `state.uiActions`.
- **shouldContinue:** `lastMessage.tool_calls?.length ? "tools" : END`. This is the entire branching logic; keep it that dumb.

This is deliberately the canonical ReAct shape — the simplest graph that does the job (project principle: avoid unnecessary abstraction). Documented growth points: a `summarize` node before `agent` when `messages` token count exceeds a budget; a `plan` node for multi-step teaching sessions. Do not build them until needed.

---

## 4. Memory / checkpointing

- **Checkpointer:** `MemorySaver` (in-process). Each chat session maps to a LangGraph thread: `configurable: { thread_id: sessionId }`. Multi-turn context works because the checkpointer replays prior state for the thread.
- **Accepted consequence (ADR-007):** conversation history dies when the dev server restarts. Fine for a single-user local MVP.
- **Upgrade path (v1.1, do not build now):** persist transcripts to the reserved `sessions` table after each turn (`DATABASE_DESIGN.md` §2) and rehydrate `messages` on first request after a restart.

---

## 5. Streaming: LangGraph events → SSE events

The chat route handler calls `graph.streamEvents(input, { version: "v2", configurable })` and translates. This table **is the contract** between Phase 5 (agent) and Phase 6 (UI) — implement it exactly:

| LangGraph event | Condition | SSE event emitted |
|---|---|---|
| `on_chat_model_stream` | chunk has text content | `token` `{ text }` |
| `on_tool_start` | any tool | `tool_start` `{ tool, args }` |
| `on_tool_end` | knowledge tool | `tool_end` `{ tool }` |
| `on_tool_end` | UI-action tool | `tool_end` + `ui_action` `{ action }` |
| `on_chain_end` (graph root) | — | `sources` `{ files }`, then `done` `{}` |
| any thrown error | — | `error` `{ code, message }`, then `done` `{}` |

Full SSE payload types and a worked example transcript live in `API_CONTRACTS.md` §5.

**Why stream tool events at all:** the terminal shows "◈ searching: *radial layout*…" while the agent works. Visible tool activity is the difference between a chat that feels broken for 8 seconds and one that feels alive — and it doubles as a free debugging log.

---

## 6. Error handling

| Failure | Behavior |
|---|---|
| Tool throws (bad path, empty index) | Catch inside the tool; return a structured error string as the ToolMessage (e.g. `ERROR INDEX_EMPTY: run indexing first`). The model reads it and adapts or relays. The graph never crashes on tool errors. |
| Anthropic API error / rate limit | One retry with backoff (SDK default), then SSE `error` + `done`. Partial tokens already sent stay rendered; the client marks the message as interrupted. |
| `recursionLimit` (25) hit | LangGraph throws `GraphRecursionError` → SSE `error` `{ code: "BUDGET_EXCEEDED" }`. Prompt tells the model to answer with partial findings *before* burning the budget. |
| Client disconnects mid-stream | Route handler aborts the run via `AbortSignal` so tokens/tool calls stop billing. |

---

## 7. Configuration (one place)

`lib/agent/graph.ts` exports a single `buildAgentGraph(deps)` factory. All knobs live there:

```ts
const CONFIG = {
  model: "claude-sonnet-5",
  temperature: 0.2,
  maxTokens: 2048,
  recursionLimit: 25,
  requestTimeoutMs: 120_000,
};
```

`deps` injects the retriever, graph lookups, and repo root — the graph module itself does no I/O directly. This keeps orchestration testable: unit tests pass fake tools and assert transitions without touching the filesystem or the API.
