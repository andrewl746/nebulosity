import type { BRIDGE_VERSION, RepoList } from "../../lib/contracts";

/**
 * Who answered `GET /api/repos` on the Map's port (V1.8 plan P14, Review Focus 5). One request tells all four apart:
 * - current: a Nebulosity that speaks this extension's bridge;
 * - old: a Nebulosity from before V1.8 (its RepoList has no `server`), which can't be framed or talked to;
 * - mismatch: a Nebulosity on another bridge version;
 * - foreign: another app holds the port (HTML, a 404, an unparseable body…), so it is never framed.
 */
export type ServerCheck = { kind: "current"; list: RepoList } | { kind: "old" } | { kind: "mismatch"; bridge: number } | { kind: "foreign" };

/**
 * The bridge this extension speaks (API_CONTRACTS §20). A type import can't bring BRIDGE_VERSION's value, but its type
 * is the literal 1, so this line stops compiling the day contracts.ts moves the version.
 */
const BRIDGE: typeof BRIDGE_VERSION = 1;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A RepoList's shape (API_CONTRACTS §15), with `server` left to the caller: the fields the extension reads, checked. */
function isRepoList(body: unknown): body is RepoList {
    if (!isObject(body)) return false;
    if (body.active !== null && typeof body.active !== "string") return false;
    return Array.isArray(body.repos) && body.repos.every((repo) => isObject(repo) && typeof repo.root === "string" && typeof repo.name === "string");
}

/**
 * Classifies the answer: its status, and its body parsed as JSON (or whatever stands in for a body that wasn't JSON).
 * Only a 200 carrying a RepoList is Nebulosity. A `server` that is there but isn't `{ version, bridge }` makes it not a
 * RepoList, so it's foreign too.
 */
export function classifyRepos(status: number, body: unknown): ServerCheck {
    if (status !== 200 || !isRepoList(body)) return { kind: "foreign" };
    const server: unknown = body.server;
    if (server === undefined) return { kind: "old" };
    if (!isObject(server) || typeof server.version !== "string" || typeof server.bridge !== "number") return { kind: "foreign" };
    return server.bridge === BRIDGE ? { kind: "current", list: body } : { kind: "mismatch", bridge: server.bridge };
}

/** One probe of the port: who answered, or "refused" (nothing listens) or "timeout" (something listens, no answer yet). */
export type Probe = ServerCheck | "refused" | "timeout";

/** What to do next: use the answer, wait (for this window's own Map, or for whatever holds the port), start one, or say it can't. */
export type NextStep = { kind: "use"; check: ServerCheck } | { kind: "waitOwn" } | { kind: "wait" } | { kind: "notInstalled" } | { kind: "start" };

/**
 * After the probe (design §4.2). Whoever answers is used, with or without a `nebulosity` command, so a Map started some
 * other way (npx, a checkout) works without an install. A Map this window started on the port is waited on, never
 * started twice; a port that's held but not answering yet is waited on too. Only a free port needs the command: then
 * it's started, or, with none found, "not installed".
 */
export function afterProbe(probe: Probe, installed: boolean, ownChildOnPort: boolean): NextStep {
    if (probe !== "refused" && probe !== "timeout") return { kind: "use", check: probe };
    if (ownChildOnPort) return { kind: "waitOwn" };
    if (probe === "timeout") return { kind: "wait" };
    return installed ? { kind: "start" } : { kind: "notInstalled" };
}
