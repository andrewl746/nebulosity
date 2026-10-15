/** The statistics of Eval #3's gate (ADR-060): medians, per-question ratios, a seeded percentile bootstrap. Imports nothing. */

/** The median, the mean of the middle two for an even count; Infinity counts as a value (a run that never reached). */
export function median(xs: readonly number[]): number {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A question's TTRC ratio, N's median ÷ A's, null meaning never reached: A never → 0, N never → ∞, both → 1. */
export function ratioOfMedians(a: readonly (number | null)[], n: readonly (number | null)[]): number {
    const [ma, mn] = [median(a.map((x) => x ?? Infinity)), median(n.map((x) => x ?? Infinity))];
    if (ma === Infinity && mn === Infinity) return 1;
    if (ma === Infinity) return 0;
    if (mn === Infinity) return Infinity;
    return ma === 0 ? (mn === 0 ? 0 : Infinity) : mn / ma;
}

/** A question's ratio of medians for values that are always there (time, cost). */
export function ratioOfPlainMedians(a: readonly number[], n: readonly number[]): number {
    const [ma, mn] = [median(a), median(n)];
    return ma === 0 ? (mn === 0 ? 0 : Infinity) : mn / ma;
}

/** A seeded generator (the TTRC design check's), uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The p-quantile of sorted values, interpolated between order statistics (numpy's default); an infinite neighbour stays infinite. */
export function quantile(sorted: readonly number[], p: number): number {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    if (lo === hi || sorted[lo] === sorted[hi]) return sorted[lo];
    return sorted[hi] === Infinity ? Infinity : sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** The 95% percentile bootstrap interval of the median over questions: resample them with replacement (D1, condition 1). */
export function bootstrapMedianInterval(values: readonly number[], options: { resamples: number; seed: number } = { resamples: 10_000, seed: 1 }): [number, number] {
    const random = mulberry32(options.seed);
    const medians: number[] = [];
    for (let b = 0; b < options.resamples; b++){
        const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]);
        medians.push(median(sample));
    }
    medians.sort((x, y) => x - y);
    return [quantile(medians, 0.025), quantile(medians, 0.975)];
}
