import path from "path";
import type { ImportsResponse } from "../contracts";
import { getDb } from "../db/client";
import { requireRepository } from "../db/store/structure";
import { readIndexVersion } from "../db/store/version";
import { parseRepoPath, repoKey } from "../index/paths";
import { reach, type Direction, type ReachAnswer } from "./reach";

/** GET /api/imports' parameters once checked (API_CONTRACTS.md §19), with the defaults filled in. */
export type ImportsQuery = { path: string; direction: Direction; transitive: boolean; limit: number; offset: number };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** §19: a longer path is refused before anything is parsed. */
const MAX_PATH_LENGTH = 1_024;

/** A whole number written in digits: "2.5", "-1", "1e2", " 5" and "" are all refused. */
function wholeNumber(raw: string): number | null {
    if (!/^\d+$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : null;
}

/** The query string as an ImportsQuery, or the message for a 400 BAD_REQUEST (§19). */
export function parseImportsQuery(params: URLSearchParams): ImportsQuery | { error: string } {
    const rawPath = params.get("path");
    if (rawPath === null) return { error: "path is required." };
    if (rawPath.length > MAX_PATH_LENGTH) return { error: `path is longer than ${MAX_PATH_LENGTH} characters.` };
    const target = parseRepoPath(rawPath);
    if (target === null) return { error: "path must be repo-relative: forward slashes, and no '..'." };
    // the whole repo has no outside to import it, and reach() refuses it too; saying so here keeps the answer a 400 either way
    if (target === "") return { error: "path must name a folder or a file: the whole repo has nothing outside it." };

    const rawDirection = params.get("direction");
    if (rawDirection !== null && rawDirection !== "dependents" && rawDirection !== "dependencies"){
        return { error: "direction must be dependents or dependencies." };
    }

    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? DEFAULT_LIMIT : wholeNumber(rawLimit);
    if (limit === null || limit < 1 || limit > MAX_LIMIT) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}.` };

    const rawOffset = params.get("offset");
    const offset = rawOffset === null ? 0 : wholeNumber(rawOffset);
    if (offset === null) return { error: "offset must be a whole number, 0 or more." };

    return { path: target, direction: rawDirection ?? "dependents", transitive: params.get("transitive") === "true", limit, offset };
}

/**
 * Answers kept per repo for one index version at a time; a new version empties them (as describe's are, ADR-036).
 * `entries` counts the files they list.
 */
type CachedAnswers = { version: number; answers: Map<string, ReachAnswer>; entries: number };
const answerCache = new Map<string, CachedAnswers>();
/**
 * Two bounds on one version's answers, not an LRU: past either the map starts over (as describe's does). Counting the
 * answers alone isn't enough, since each holds its whole transitive list, and a busy file of VS Code's reaches
 * thousands: 2,000 such answers would hold millions of entries. So the files listed are bounded too, and an answer that
 * alone lists more than that bound is answered but never kept.
 */
const MAX_CACHED_ANSWERS = 2_000;
const MAX_CACHED_ENTRIES = 200_000;
let limits = { answers: MAX_CACHED_ANSWERS, entries: MAX_CACHED_ENTRIES };

/** For the tests only: lowers the cache's bounds; the function it gives puts the real ones back. */
export function setCacheLimitsForTests(next: Partial<typeof limits>): () => void {
    const before = limits;
    limits = { ...limits, ...next };
    return () => { limits = before; };
}

/**
 * reach() with its answers kept per index version, like describe (API_CONTRACTS.md §19): the extension asks the same
 * question again for a QuickPick's "show all", and a walk over VS Code's graph from a busy file costs more than a lookup.
 * The answer is shared between callers, so treat it as read-only. A path with nothing indexed throws, and a throw is never cached.
 */
export function cachedReach(repoRoot: string, targetPath: string, direction: Direction): ReachAnswer {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);

    // one read transaction, as describe() does: the version read here is the one reach() answers for
    return db.transaction(() => {
        const version = readIndexVersion(db, repoId);
        // the repo's id is in the key because a re-created repo starts counting again
        const cacheKey = `${repoId}\0${repo}`;
        let cached = answerCache.get(cacheKey);
        if (!cached || cached.version !== version){
            cached = { version, answers: new Map(), entries: 0 };
            answerCache.set(cacheKey, cached);
        }
        const key = `${direction}\0${targetPath}`;
        const hit = cached.answers.get(key);
        if (hit) return hit;

        const answer = reach(repoRoot, targetPath, direction);
        const size = answer.reached.length;
        // emptying the cache wouldn't make room for it, so what's kept stays
        if (size > limits.entries) return answer;
        if (cached.answers.size >= limits.answers || cached.entries + size > limits.entries){
            cached.answers.clear();
            cached.entries = 0;
        }
        cached.answers.set(key, answer);
        cached.entries += size;
        return answer;
    });
}

/**
 * One page of a reach answer (API_CONTRACTS.md §19). Without `transitive` only the files one import away count, and
 * reach() lists those first, so they are the first `direct` entries. `total` is the length before paging; a page past
 * the end is empty.
 */
export function importsPage(answer: ReachAnswer, query: ImportsQuery): ImportsResponse {
    const counted = query.transitive ? answer.reached : answer.reached.slice(0, answer.direct);
    return {
        path: answer.path,
        kind: answer.kind,
        direction: answer.direction,
        transitive: query.transitive,
        files: counted.slice(query.offset, query.offset + query.limit),
        direct: answer.direct,
        total: counted.length,
        offset: query.offset,
        indexVersion: answer.indexVersion,
    };
}
