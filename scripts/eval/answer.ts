/** Reading a run's final answer and scoring it against the truth (D2, R4 in docs/plans/2026-10-13-v1-5-ship.md). */
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/** The text after the last line that starts with ANSWER: (any case, markdown around it ignored), or null. */
export function answerSection(text: string): string | null {
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--){
        const m = /^[\s>*_#-]*answer\s*:\s*\**\s*(.*)$/i.exec(lines[i]);
        if (m) return [m[1], ...lines.slice(i + 1)].join("\n").trim();
    }
    return null;
}

export const isNone = (section: string): boolean => /^\W*none\b/i.test(section.trim());

/**
 * The repo's files an answer lists, in order, once each, matched without regard to case (the eval runs on Windows):
 * absolute paths inside the repo with either slash, or repo-relative ones, stripped of bullets, numbering, backticks,
 * quotes and a trailing :line or #Lline. Anything path-like that isn't a file of the repo goes to notFiles.
 */
export function extractPaths(section: string, repoRoot: string, known: ReadonlySet<string>): { files: string[]; notFiles: string[] } {
    const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const canonical = new Map([...known].map((k) => [k.toLowerCase(), k]));
    const files: string[] = [];
    const notFiles: string[] = [];
    for (const token of section.match(/[^\s`'"()[\],;]+/g) ?? []){
        let p = token.replace(/\\/g, "/").replace(/^[-*•>]+/, "").replace(/^\d+[.)]$/, "");
        p = p.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, "").replace(/[.:]+$/, "");
        if (!p.includes("/") && !CODE_FILE.test(p)) continue;
        if (p.toLowerCase().startsWith(`${root}/`)) p = p.slice(root.length + 1);
        p = p.replace(/^\.\//, "");
        const file = canonical.get(p.toLowerCase());
        if (file !== undefined){
            if (!files.includes(file)) files.push(file);
        } else if (!notFiles.includes(p)) notFiles.push(p);
    }
    return { files, notFiles };
}

export type ListScore = { recall: number; precision: number; hits: number; missed: string[]; extra: string[] };

/** Recall is what the eval scores lists by (PIVOT_SPEC.md §9); precision is reported beside it. */
export function scoreList(found: readonly string[], truth: readonly string[]): ListScore {
    const want = new Set(truth);
    const hits = found.filter((p) => want.has(p));
    return {
        recall: truth.length === 0 ? 1 : hits.length / truth.length,
        precision: found.length === 0 ? 0 : hits.length / found.length,
        hits: hits.length,
        missed: truth.filter((p) => !found.includes(p)),
        extra: found.filter((p) => !want.has(p)),
    };
}

export type ChainTruth = { from: string; to: string; connected: boolean; shortest: number | null };
export type ChainScore = { score: 0 | 0.5 | 1 | null; valid: boolean; steps: number | null; problem?: string; unknown?: [string, string] };

/**
 * 1 for a valid chain of the shortest length or a right "none", 0.5 for a valid longer chain, 0 otherwise (D2). `to`
 * may be a folder. `imports` says whether one file imports another: true, false, or null when nobody knows yet. A null
 * step leaves the score null until it's adjudicated by reading the source (R4).
 */
export function scoreChain(answer: { none: boolean; files: readonly string[] }, truth: ChainTruth, imports: (a: string, b: string) => boolean | null): ChainScore {
    if (!truth.connected){
        return answer.none && answer.files.length === 0
            ? { score: 1, valid: true, steps: null }
            : { score: 0, valid: false, steps: null, problem: "claims a chain where none exists" };
    }
    const f = answer.files;
    if (answer.none || f.length < 2) return { score: 0, valid: false, steps: null, problem: "no chain given" };
    const steps = f.length - 1;
    const reaches = (p: string): boolean => p === truth.to || p.startsWith(`${truth.to}/`);
    if (f[0] !== truth.from || !reaches(f[f.length - 1])) return { score: 0, valid: false, steps, problem: "doesn't run from the first file to the last" };
    for (let i = 0; i < steps; i++){
        const known = imports(f[i], f[i + 1]);
        if (known === null) return { score: null, valid: false, steps, unknown: [f[i], f[i + 1]] };
        if (!known) return { score: 0, valid: false, steps, problem: `${f[i]} doesn't import ${f[i + 1]}` };
    }
    if (truth.shortest !== null && steps < truth.shortest) return { score: 1, valid: true, steps, problem: "shorter than the truth's shortest: recheck the truth" };
    return { score: steps === truth.shortest ? 1 : 0.5, valid: true, steps };
}
