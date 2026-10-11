# VISUALIZATION_DESIGN.md — Graph Layout & Scaling Strategy

> **Superseded 2026-10-11** by `PIVOT_SPEC.md` §7 and ADR-029 (levels, lenses, a 50-box cap, pre-aggregated level edges). The "Tier XL is a product boundary" decision is reversed (ADR-024). Kept for history; dagre (ADR-011) still applies.

**Status:** Approved design
**Scope:** the dependency graph's layout algorithms, their upgrade path, and the plan for keeping Nebulosity fast (and un-crashed) on massive codebases
**Companions:** `GRAPH_IMPLEMENTATION_REVIEW.md` (current-code weaknesses), ADR-011/ADR-012 in `ENGINEERING_DECISIONS.md` (the decisions this doc explains)

Visualization is Nebulosity's identity — the graph *is* the product's first impression and the agent's shared workspace with the user. This doc treats layout as a first-class subsystem, not a styling detail.

---

## 1. Current layout: deterministic radial rings

```
file index (0..n-1)
      │
radialPosition(index, total)        lib/graph.ts:52-72
      │
{ x, y } canvas coordinates
```

**Algorithm:** node 0 at the origin; remaining nodes fill concentric rings whose capacity grows linearly with ring number (6, 12, 18, …). Within a ring, nodes are spaced evenly by angle; alternate rings are rotated half a slot so spokes don't align. Pure function of `(index, total)` — no randomness, no I/O.

**Properties (and why they were chosen for the MVP):**

| Property | Value |
|---|---|
| Complexity | O(√n) per node, O(n·√n) total — trivially fast to thousands of nodes |
| Determinism | Same input order → same picture (input order sorting is fix F4 in the review) |
| Overlap | Never — capacity math guarantees spacing |
| Edge-awareness | **None** — its fundamental limitation |
| Dependencies | Zero |

**The known limitation (be able to say this unprompted):** position encodes *scan order*, which is meaningless. Two tightly-coupled files can land on opposite sides; edges cross the canvas arbitrarily. Fine at ≤50 nodes; visually misleading beyond ~150. That is why the layout is quarantined behind one pure function — the swap surface is a single signature: `(graph) → Map<nodeId, {x, y}>`.

## 2. Target layout pipeline

```
dependency graph (nodes + edges)
      │
layout algorithm (pluggable: radial | dagre | force | elk)
      │
optimized coordinates (edge-aware, stable, cached)
```

Design rules for the upgrade, regardless of algorithm chosen:

1. **Layout is a pure core function** (`lib/layout/<name>.ts`), selected by a config string — the renderer never knows which algorithm ran.
2. **Edges become an input.** Every candidate below consumes the edge list; radial ignores it. The function signature changes once (from `(index, total)` to `(nodes, edges)`), then never again.
3. **Positions get cached** keyed by a hash of the node+edge sets (a small table in the ADR-013 SQLite database) — so an expensive layout runs once per graph change, not once per page load. This also buys **stability**: unchanged graph → identical picture, which protects the user's spatial memory.
4. **Heavy layouts never run on the request path.** They run in a worker (server-side `worker_threads` or a browser Web Worker) with the radial result shown instantly as a fallback, then animated to final positions when the worker finishes. The page is never blocked by layout math.

## 3. Candidate algorithms (the upgrade menu)

| | **Dagre** | **ELK (elkjs)** | **Force-directed (d3-force)** |
|---|---|---|---|
| Paradigm | Layered/hierarchical (Sugiyama) | Layered + many strategies | Physics simulation (springs + repulsion) |
| Best when | Graph is mostly a DAG — which import graphs are | Same, plus ports/nested groups | Organic clusters; no inherent direction |
| Reads as | "Architecture diagram": entry points top, utilities bottom — **matches how developers already think about dependencies** | Same, more polished, more knobs | "Galaxy": clusters emerge — thematically perfect for Nebulosity |
| Cost | Fast to ~2k nodes | Heaviest; ships a WASM/worker build | O(n log n)/tick with Barnes-Hut; needs ~300 ticks; **non-deterministic unless seeded** |
| Stability across runs | Good | Good | Poor without seeding + position pinning |
| Bundle/dep weight | Small (`@dagrejs/dagre`) | Large | Small (`d3-force`), already-familiar API |
| Verdict | **First upgrade (ADR-011)** | Only if dagre's output disappoints | Optional "nebula mode" toggle later — beauty over legibility |

**Decision (ADR-011): dagre first.** Import graphs are near-DAGs and layered layout answers the product's core question — "what sits on top of what" — literally. Rank direction top-to-bottom (entry points at top), cycles broken by dagre's built-in heuristic. d3-force is kept as a documented aesthetic mode, not the default, because reproducibility beats beauty in an onboarding tool.

**Graph algorithms this unlocks beside layout:** the same adjacency structure feeds degree centrality (ADR-010, powers `get_central_files`), BFS path-finding for the agent's "trace X to Y" recipe, and cycle detection (circular imports — worth surfacing as a warning badge; cheap DFS with a recursion stack).

---

## 4. Scaling strategy — the "MASSIVE codebase" plan

### 4.1 Know your enemy: what actually breaks, in order

Understand the failure sequence before fixing it — each bottleneck hits at a different scale:

| Scale (source files) | What breaks first | Symptom |
|---|---|---|
| ~1k | `animated: true` edges + full DOM rendering | Pan/zoom drops below 60 fps |
| ~2–5k | React Flow DOM node count; dagre on the main thread | Multi-second freezes, janky interaction |
| ~10k | JSON payload size (`GET /api/graph` ships everything); browser memory | Slow loads, tab memory in the GBs |
| ~50k+ | Synchronous scan time; vector store JSON parse (ADR-006 ceiling) | Server request timeouts; startup stalls |
| any scale | One unbounded recursion or unreadable file | Crash (fixed by review items F2/F4) |

### 4.2 The central insight: don't render what no human can read

A 50,000-node graph is not a visualization, it's noise — no rendering technology fixes that. So the scaling answer is **the same as the comprehension answer: aggregate**. This alignment is the key design idea (ADR-012):

**Hierarchical clustering by directory.** Above a node budget, the graph renders *directories as super-nodes*: `app/components/` becomes one node whose size reflects its file count; edges between super-nodes aggregate the underlying file edges (with a count badge). Clicking a super-node expands one level. The user drills from `src/` → `src/services/` → individual files — which mirrors exactly how a developer explores an unfamiliar repo anyway. Onboarding *wants* progressive disclosure; performance *needs* bounded node counts. One mechanism serves both.

**The node budget:** the client never renders more than **~400 visible nodes** (super or file). The server enforces it: `GET /api/graph` gains optional `?root=<dir>&depth=<n>` params and auto-collapses until the budget is met. 400 DOM nodes with memoized components is comfortably 60 fps territory in React Flow.

### 4.3 The tier plan (concrete, per-layer)

**Tier S — < 300 files (today's target, v1):**
Current design as-is, plus the review's P0 fixes (no idle animations, memoized nodes). Nothing else needed — do not pre-build for scale that isn't scheduled.

**Tier M — 300–3,000 files:**
- `onlyRenderVisibleElements` on React Flow (viewport culling — off-screen nodes don't hit the DOM).
- Level-of-detail: below a zoom threshold, `FileNode` renders as a colored dot (skip text/subfolder DOM entirely) — cheap `useStore(zoomSelector)` check.
- Dagre layout in a worker + `layout.json` cache (§2 rules 3–4).
- Scan goes async (`fs.promises`, concurrency ~32) so a big scan doesn't block the event loop (folds into review F2's error-handling rework).

**Tier L — 3,000–50,000 files:**
- **Directory clustering on by default** (§4.2) with the 400-node budget and expand-on-demand fetches.
- Graph built incrementally server-side and cached in `.nebulosity/` using the Phase 2 manifest hashes — rescans touch only changed files.
- Vector store flips to the binary `Float32Array` file per ADR-006's documented trigger; retrieval unchanged.
- Agent tools get graph-aware summarization: `get_central_files` and `get_dependencies` operate on the full graph server-side (it's just adjacency lists — 50k nodes is *nothing* for data structures; it's only rendering that struggles).

**Tier XL — beyond 50k:**
Documented product boundary, not an engineering sprint: Nebulosity's mission is one developer understanding one repo deeply — at monorepo-of-monorepos scale the right UX is "pick a subtree" (`?root=packages/checkout`), which Tier L's params already provide. If true whole-graph rendering ever becomes a goal, the exit ramp is a WebGL renderer (sigma.js / cosmograph) replacing React Flow for the overview — recorded as an option, explicitly out of scope.

### 4.4 Crash-proofing (the "make it not crash" checklist)

Independent of tier — these are hard guards, most already scheduled:

1. **No unbounded work on a request:** scan concurrency capped; per-file try/catch (review F2); layout in workers with a timeout → fall back to cached/radial positions.
2. **No unbounded payloads:** the 400-node budget is enforced server-side; `GET /api/graph` can never emit a 200 MB response no matter the repo.
3. **No unbounded memory:** chunks/vectors stream-written per file during indexing (already the design); binary vectors at Tier L.
4. **Degrade, don't die:** every guard has a fallback behavior (cached layout, collapsed graph, partial scan with warnings surfaced in `stats`) — the user always gets *a* graph plus an honest warning, never a spinner-of-death or a 500.

---

## 5. What this changes in the rest of the doc set

Applied in the same change set (per the maintenance rule in `ARCHITECTURE.md`):

- `ENGINEERING_DECISIONS.md`: **ADR-011** (dagre first, pluggable layouts) and **ADR-012** (hierarchical clustering + node budget) added.
- `API_CONTRACTS.md`: `?root=&depth=` reserved on `GET /api/graph` (Tier L; not implemented in v1).
- `IMPLEMENTATION_ROADMAP.md`: post-v1 backlog now references the tier plan instead of a bare "dagre/d3-force" bullet.
- `DATABASE_DESIGN.md` §7 updated: layout positions are only derived-and-unstored *while radial is active* — once ADR-011 lands, `layout.json` gets cached following the existing manifest/atomic-write pattern (schema detail kept here, not duplicated there, since the file doesn't exist yet).
