/**
 * Time to relevant context (ADR-060, D2 of V1.7's plan): when a run had first seen every file its answer needs. Pure:
 * a kept (scrubbed) transcript in, times and token counts out. A needed file is seen at a main-conversation `user` event
 * carrying tool results, when it is named, as a whole path token, by a result's text or by the call it answers (Read's
 * file_path, Grep's and Glob's path, a Bash command that wasn't refused). Relative paths are read from Claude Code's
 * working folder, as the executed cd commands left it. Imports nothing from lib/.
 */
import path from "path";
import { streamEvents, type Json } from "./transcript";

export type Needed =
    | { kind: "files"; files: string[] }
    /** A chain or cycle (needed.ts): the shortest-path DAG; seen once every file strictly between the ends of one path is. */
    | { kind: "paths"; nodes: string[]; edges: [string, string][]; from: string[]; to: string[] };

export type ContextInput = {
    jsonl: string;
    startedAt: string;
    /** How scrubbed transcripts write the repo's root: "vscode" for "<vscode>". */
    repoId: string;
    needed: Needed;
    /** The repo's tracked files, lower-cased: what the mostly-relevant version counts. */
    tracked: ReadonlySet<string>;
};

export type ContextResult = {
    reached: boolean;
    /** From the run's startedAt, the gate's measure (R-F); null when never reached. */
    ttrcMs: number | null;
    /** From the query start: the last event's timestamp minus the result's duration_ms. */
    ttrcQueryMs: number | null;
    /** Input + cache writes + cache reads of the main conversation's calls before the reaching event, once per message id. */
    tokens: number | null;
    /** The share of the needed files seen by the end (for a chain or cycle, the best path's share). */
    coverage: number;
    mostlyRelevant: { reached: boolean; ttrcMs: number | null; ttrcQueryMs: number | null };
};

const DENIED = /Permission to use [\w ]+ has been denied/i;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A text's path tokens: runs of path characters, the scrubbed root taken off, `\` as `/`, case folded, a leading ./ and trailing dots dropped. */
export function pathTokens(text: string, repoId: string): string[] {
    const cleaned = text.replace(new RegExp(`<${escape(repoId)}>[\\\\/]+`, "gi"), "");
    const out: string[] = [];
    for (const raw of cleaned.match(/[A-Za-z0-9_\-@$.+~\\/]+/g) ?? []){
        let t = raw.replace(/\\+/g, "/").replace(/\/{2,}/g, "/");
        while (t.startsWith("./")) t = t.slice(2);
        if (t.includes("/../") || t.endsWith("/..")) t = path.posix.normalize(t);   // x/../a.ts names a.ts
        t = t.replace(/\.+$/, "");
        if (t !== "") out.push(t.toLowerCase());
    }
    return out;
}

/**
 * Where a Bash command leaves Claude Code's working folder: every top-level cd in it, in order (each from the folder the one
 * before left, so `cd a && cd b` is a/b and `cd ../..` climbs), from the repo root (""); null outside the repo (also for
 * a cd that climbs out of it); undefined without a cd. A cd that failed without being refused still counts: not detectable.
 */
export function cdTarget(command: string, cwd: string | null, repoId: string): string | null | undefined {
    const re = /(?:^|&&|;|\|\||\n)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g;
    const rootedRe = new RegExp(`^<${escape(repoId)}>(?:/|$)`, "i");
    let at: string | null | undefined;
    let current = cwd;
    for (let m = re.exec(command); m !== null; m = re.exec(command)){
        const t = m[1].replace(/^["']|["']$/g, "").replace(/\\+/g, "/");
        const rooted = rootedRe.exec(t);
        let next: string | null;
        if (rooted) next = join("", t.slice(rooted[0].length));
        else if (/^([A-Za-z]:\/|\/|~|<)/.test(t) || current === null) next = null;
        else next = join(current, t);
        at = current = next;
    }
    return at;
}

/** A folder joined with a relative path, normalized, lower-cased: "" for the root, null when it climbs out of the repo. */
function join(folder: string, relative: string): string | null {
    const joined = path.posix.normalize(path.posix.join(folder || ".", relative || "."));
    return joined === "." || joined === "./" ? "" : joined === ".." || joined.startsWith("../") ? null : joined.replace(/\/$/, "").toLowerCase();
}

/** The best path's seen middle files and its length in middle files (all shortest paths are equally long). */
function bestPath(n: Extract<Needed, { kind: "paths" }>, have: ReadonlySet<string>): { seen: number; length: number } {
    const next = new Map<string, string[]>();
    for (const [a, b] of n.edges) next.set(a, [...(next.get(a) ?? []), b]);
    const targets = new Set(n.to);
    const memo = new Map<string, { seen: number; steps: number } | null>();
    const walk = (node: string): { seen: number; steps: number } | null => {
        if (targets.has(node)) return { seen: 0, steps: 0 };
        if (memo.has(node)) return memo.get(node)!;
        let best: { seen: number; steps: number } | null = null;
        for (const w of next.get(node) ?? []){
            const r = walk(w);
            if (r === null) continue;
            const here = { seen: r.seen + (!targets.has(w) && have.has(w.toLowerCase()) ? 1 : 0), steps: r.steps + 1 };
            if (best === null || here.seen > best.seen) best = here;
        }
        memo.set(node, best);
        return best;
    };
    let seen = 0;
    let steps = 0;
    for (const s of n.from){
        const r = walk(s);
        if (r !== null && (r.seen > seen || steps === 0)){
            seen = r.seen;
            steps = r.steps;
        }
    }
    return { seen, length: Math.max(0, steps - 1) };
}

export function pathReached(n: Extract<Needed, { kind: "paths" }>, have: ReadonlySet<string>): boolean {
    const { seen, length } = bestPath(n, have);
    return length > 0 && seen === length;
}

const resultText = (c: Json): string => (typeof c.content === "string" ? c.content
    : Array.isArray(c.content) ? c.content.map((x: Json | string) => (typeof x === "string" ? x : x.text ?? "")).join("\n") : "");

export function relevantContext(input: ContextInput): ContextResult {
    // a chain's or cycle's ends are given by the question; only the files strictly between them are needed (D2)
    const ends = input.needed.kind === "paths" ? new Set([...input.needed.from, ...input.needed.to]) : new Set<string>();
    const neededSet = new Set((input.needed.kind === "files" ? input.needed.files : input.needed.nodes.filter((n) => !ends.has(n))).map((f) => f.toLowerCase()));
    const reachedWith = (have: ReadonlySet<string>): boolean =>
        input.needed.kind === "files" ? input.needed.files.every((f) => have.has(f.toLowerCase())) : pathReached(input.needed, have);
    const seen = new Set<string>();
    const seenMostly = new Set<string>();
    const uses = new Map<string, Json>();
    const messages = new Set<string>();
    let tokens = 0;
    let cwd: string | null = "";
    let reached: { at: number; tokens: number } | null = null;
    let mostly: number | null = null;
    let lastAt = NaN;
    let durationMs: number | null = null;

    for (const e of streamEvents(input.jsonl)){
        if (typeof e.timestamp === "string") lastAt = Date.parse(e.timestamp);
        if (e.type === "result" && typeof e.duration_ms === "number") durationMs = e.duration_ms;
        if (e.parent_tool_use_id) continue;   // a subagent's own traffic; its final text comes back as the Agent call's result
        if (e.type === "assistant"){
            const id = e.message?.id;
            if (typeof id === "string" && !messages.has(id)){
                messages.add(id);
                const u = e.message.usage ?? {};
                tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
            }
            for (const c of (e.message?.content ?? []) as Json[]) if (c.type === "tool_use") uses.set(c.id, c);
            continue;
        }
        if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
        const results = (e.message.content as Json[]).filter((c) => c.type === "tool_result");
        if (results.length === 0) continue;
        for (const r of results){
            const use = uses.get(r.tool_use_id);
            const text = resultText(r);
            const refused = r.is_error === true && DENIED.test(text);
            const inputs: string[] = [];
            const before = cwd;
            if (use?.name === "Read" && typeof use.input?.file_path === "string") inputs.push(use.input.file_path);
            if ((use?.name === "Grep" || use?.name === "Glob") && typeof use.input?.path === "string") inputs.push(use.input.path);
            if (use?.name === "Bash" && !refused && typeof use.input?.command === "string"){
                inputs.push(use.input.command);
                const moved = cdTarget(use.input.command, cwd, input.repoId);
                if (moved !== undefined) cwd = moved;
            }
            const folders = [...new Set([before, cwd].filter((f): f is string => f !== null && f !== ""))];
            const names = (texts: string[]): Set<string> => {
                const found = new Set<string>();
                for (const t of pathTokens(texts.join("\n"), input.repoId)){
                    for (const candidate of [t, ...folders.map((f) => path.posix.normalize(`${f}/${t}`))]){
                        if (neededSet.has(candidate) || input.tracked.has(candidate)) found.add(candidate);
                    }
                }
                return found;
            };
            const named = names([...inputs, text]);
            for (const f of named) if (neededSet.has(f)) seen.add(f);
            // the mostly-relevant version: a Read names its own file; any other result counts when half its tracked files are needed
            const counted = use?.name === "Read" ? names(inputs) : named;
            const tracked = [...counted].filter((f) => input.tracked.has(f));
            const useful = tracked.filter((f) => neededSet.has(f));
            if (tracked.length > 0 && useful.length * 2 >= tracked.length) for (const f of useful) seenMostly.add(f);
        }
        const now = Date.parse(e.timestamp);
        if (reached === null && reachedWith(seen)) reached = { at: now, tokens };
        if (mostly === null && reachedWith(seenMostly)) mostly = now;
    }

    const start = Date.parse(input.startedAt);
    const queryStart = durationMs === null || Number.isNaN(lastAt) ? null : lastAt - durationMs;
    const coverage = input.needed.kind === "files"
        ? input.needed.files.filter((f) => seen.has(f.toLowerCase())).length / input.needed.files.length
        : (({ seen: s, length }) => (length === 0 ? 0 : s / length))(bestPath(input.needed, seen));
    return {
        reached: reached !== null,
        ttrcMs: reached === null ? null : reached.at - start,
        ttrcQueryMs: reached === null || queryStart === null ? null : reached.at - queryStart,
        tokens: reached === null ? null : reached.tokens,
        coverage,
        mostlyRelevant: {
            reached: mostly !== null,
            ttrcMs: mostly === null ? null : mostly - start,
            ttrcQueryMs: mostly === null || queryStart === null ? null : mostly - queryStart,
        },
    };
}
