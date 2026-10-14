/**
 * Scoring for Search Benchmark #2 (docs/plans/2026-10-13-v1-5-ship.md, D5): each query of the tuning set lists the
 * targets a person would expect, by hand, and a ranking is judged by where the first of them lands.
 */
export type Expectation = { query: string; group: "names" | "features" | "questions"; expect: string[] };
export type RankedHit = { path: string; kind: "file" | "folder" };
export type Metrics = { queries: number; hitAt1: number; hitAt3: number; hitAt5: number; mrr: number };

/** A folder expectation ends in "/" and takes the folder or anything inside it; a file expectation takes only that file. */
export function accepts(expected: string, hit: RankedHit): boolean {
    if (!expected.endsWith("/")) return hit.kind === "file" && hit.path === expected;
    const folder = expected.slice(0, -1);
    return hit.path === folder || hit.path.startsWith(`${folder}/`);
}

/** The 1-based rank of the first hit any expectation takes, or null when none does. */
export function firstAcceptable(hits: readonly RankedHit[], expect: readonly string[]): number | null {
    const at = hits.findIndex((hit) => expect.some((e) => accepts(e, hit)));
    return at === -1 ? null : at + 1;
}

/** hit@k: the share of queries whose first acceptable hit is in the top k. MRR: the mean of 1/rank, 0 past rank 10. */
export function metrics(ranks: readonly (number | null)[]): Metrics {
    const within = (k: number): number => ranks.filter((r) => r !== null && r <= k).length / ranks.length;
    const mrr = ranks.reduce<number>((sum, r) => sum + (r !== null && r <= 10 ? 1 / r : 0), 0) / ranks.length;
    return { queries: ranks.length, hitAt1: within(1), hitAt3: within(3), hitAt5: within(5), mrr };
}
