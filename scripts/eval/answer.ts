/** Reading a run's final answer and scoring it against the truth (D2, R4 in docs/plans/2026-10-13-v1-5-ship.md). */
const CODE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * The text after the last line that starts with ANSWER: (any case; bold, italics, quotes, headings and backticks around
 * the label ignored, but no letters or digits before it), or null.
 */
export function answerSection(text: string): string | null {
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--){
        const m = /^[\s>*_#`-]*answer[*_`]*\s*:[*_`]*\s*(.*)$/i.exec(lines[i]);
        if (m) return [m[1], ...lines.slice(i + 1)].join("\n").trim();
    }
    return null;
}

export const isNone = (section: string): boolean => /^\W*none\b/i.test(section.trim());

/**
 * The repo's files an answer lists, in order, once each, matched without regard to case (the eval runs on Windows):
 * absolute paths inside the repo with either slash, or repo-relative ones, stripped of bullets, numbering, backticks,
 * quotes, bold or italic marks, table pipes and a trailing :line or #Lline. Anything path-like that isn't a file of the
 * repo goes to notFiles. The repo root itself is not a path.
 */
export function extractPaths(section: string, repoRoot: string, known: ReadonlySet<string>, options: { repeats?: boolean } = {}): { files: string[]; notFiles: string[] } {
    const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const canonical = new Map([...known].map((k) => [k.toLowerCase(), k]));
    const files: string[] = [];
    const notFiles: string[] = [];
    // The line mark and trailing punctuation come off before the path-like test; the root and ./ after it
    const clean = (t: string): string => t.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, "").replace(/[.:]+$/, "");
    const inRepo = (t: string): string => (t.toLowerCase().startsWith(`${root}/`) ? t.slice(root.length + 1) : t).replace(/^\.\//, "");
    for (const token of section.match(/[^\s`'"()[\],;|*]+/g) ?? []){
        const bare = token.replace(/\\/g, "/").replace(/^[-•>]+/, "").replace(/^\d+[.)]$/, "");
        let p = clean(bare);
        // _italic_ marks come off only when the token isn't a file as it stands: VS Code has files like _chatperf_uri.ts
        if (!canonical.has(inRepo(p).toLowerCase())) p = clean(bare.replace(/^_(.+)_$/, "$1"));
        if (!p.includes("/") && !CODE_FILE.test(p)) continue;
        p = inRepo(p);
        if (p === "") continue;
        const file = canonical.get(p.toLowerCase());
        if (file !== undefined){
            if (options.repeats === true || !files.includes(file)) files.push(file);
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
 * may be a folder. `imports` says whether one file imports another: true, false, or null when nobody knows yet. Every
 * step is checked before the score is decided: a step known false makes it 0 (the first such step is the problem),
 * even after an unknown one, since nothing the unknown step turns out to be can save the chain. Only a chain with no
 * false step and an unknown one waits, its score null until the first unknown step is adjudicated by reading the
 * source (R4). Where no chain exists, saying "none" is the whole answer: files named alongside it ("none: d never
 * imports a") don't take the point away.
 */
export function scoreChain(answer: { none: boolean; files: readonly string[] }, truth: ChainTruth, imports: (a: string, b: string) => boolean | null): ChainScore {
    if (!truth.connected){
        return answer.none
            ? { score: 1, valid: true, steps: null }
            : { score: 0, valid: false, steps: null, problem: "claims a chain where none exists" };
    }
    const f = answer.files;
    if (answer.none || f.length < 2) return { score: 0, valid: false, steps: null, problem: "no chain given" };
    const steps = f.length - 1;
    const reaches = (p: string): boolean => p === truth.to || p.startsWith(`${truth.to}/`);
    if (f[0] !== truth.from || !reaches(f[f.length - 1])) return { score: 0, valid: false, steps, problem: "doesn't run from the first file to the last" };
    let unknown: [string, string] | undefined;
    for (let i = 0; i < steps; i++){
        const known = imports(f[i], f[i + 1]);
        if (known === false) return { score: 0, valid: false, steps, problem: `${f[i]} doesn't import ${f[i + 1]}` };
        if (known === null && unknown === undefined) unknown = [f[i], f[i + 1]];
    }
    if (unknown !== undefined) return { score: null, valid: false, steps, unknown };
    if (truth.shortest !== null && steps < truth.shortest) return { score: 1, valid: true, steps, problem: "shorter than the truth's shortest: recheck the truth" };
    return { score: steps === truth.shortest ? 1 : 0.5, valid: true, steps };
}

// ---- the new kinds (V1.6 Task 11, D2)

/** The name on a counts line, or a pairs name: markup, bullets, quotes and a trailing slash off, lowercase. */
export const plainName = (s: string): string => s.replace(/[*_`'"]/g, "").replace(/^[\s>#•-]+/, "").replace(/\/+\s*$/, "").trim().toLowerCase();

export type CountsTruth = { counts: readonly (readonly [string, number])[]; elsewhere: number; total: number };

/**
 * The mean over the truth's lines (every named folder, then elsewhere and total) of max(0, 1 - |answer - truth| / max(truth, 1)).
 * The answer's lines read `<name>: <number>`, the number with or without thousands separators, the name without regard to case;
 * a line the answer lacks scores 0. The last line for a name counts.
 */
export function scoreCounts(section: string, truth: CountsTruth): number {
    const given = new Map<string, number>();
    for (const line of section.split(/\r?\n/)){
        // after the colon: marks, an approximately sign, the number, then anything that isn't a digit ("files", a period)
        const m = /^(.*?):[\s*_`~≈]*(\d[\d,]*)[^\d\n]*$/.exec(line);
        if (m) given.set(plainName(m[1]), Number(m[2].replace(/,/g, "")));
    }
    const wanted: [string, number][] = [...truth.counts.map(([name, n]): [string, number] => [name, n]), ["elsewhere", truth.elsewhere], ["total", truth.total]];
    const scores = wanted.map(([name, n]) => {
        const said = given.get(plainName(name));
        return said === undefined ? 0 : Math.max(0, 1 - Math.abs(said - n) / Math.max(n, 1));
    });
    return scores.reduce((s, x) => s + x, 0) / scores.length;
}

/** F1 of a list against the truth, each as a set: nothing wanted and nothing listed is 1, one side empty is 0. */
export function f1(listed: readonly string[], truth: readonly string[]): number {
    const want = new Set(truth);
    const got = new Set(listed);
    if (want.size === 0 && got.size === 0) return 1;
    if (want.size === 0 || got.size === 0) return 0;
    const hits = [...got].filter((x) => want.has(x)).length;
    if (hits === 0) return 0;
    const precision = hits / got.size;
    const recall = hits / want.size;
    return (2 * precision * recall) / (precision + recall);
}

/** The pairs an answer lists, one per line as `a -> b`, `a → b` or `a->b`, both names lowercased, once each. */
export function readPairs(lines: readonly string[]): [string, string][] {
    const pairs = new Map<string, [string, string]>();
    for (const line of lines){
        const m = /^(.*?)\s*(?:->|→|=>)\s*(.*)$/.exec(line);
        if (!m) continue;
        const [a, b] = [plainName(m[1]), plainName(m[2])];
        if (a !== "" && b !== "") pairs.set(`${a}\u0000${b}`, [a, b]);
    }
    return [...pairs.values()];
}

/** F1 over the pairs (which folder imports which); names compare in lowercase. */
export function scorePairs(lines: readonly string[], truth: readonly (readonly [string, string])[]): number {
    const key = (p: readonly [string, string]): string => `${plainName(p[0])}\u0000${plainName(p[1])}`;
    return f1(readPairs(lines).map(key), truth.map(key));
}

export type CycleTruth = { file: string; shortest: number | null };
/** `score` is null while a step of the cycle is unknown (nobody has read it yet): `unknown` names the first such step. */
export type CycleScore = { score: 0 | 0.5 | 1 | null; valid: boolean; steps: number | null; problem?: string; unknown?: [string, string] };

/**
 * 1 for a valid cycle of the shortest length or a right "none", 0.5 for a valid longer one, 0 otherwise (D2). Valid: it starts
 * and ends at the file, has at least 2 steps, and every step is an import. A step known false makes it 0; with none false and one
 * unknown the score is null until that step is read (as scoreChain's). One shorter than the truth's shortest scores 1, and a
 * valid cycle where the truth says none scores 0; both are flagged for a recheck of the truth.
 */
export function checkCycle(paths: readonly string[] | "none", truth: CycleTruth, imports: (a: string, b: string) => boolean | null): CycleScore {
    if (paths === "none"){
        return truth.shortest === null ? { score: 1, valid: true, steps: null } : { score: 0, valid: false, steps: null, problem: "says none, but the file is in a cycle" };
    }
    const steps = paths.length - 1;
    if (steps < 2) return { score: 0, valid: false, steps, problem: "a cycle needs at least 2 steps" };
    if (paths[0] !== truth.file || paths[steps] !== truth.file) return { score: 0, valid: false, steps, problem: "doesn't start and end at the file" };
    let unknown: [string, string] | undefined;
    for (let i = 0; i < steps; i++){
        const known = imports(paths[i], paths[i + 1]);
        if (known === false) return { score: 0, valid: false, steps, problem: `${paths[i]} doesn't import ${paths[i + 1]}` };
        if (known === null && unknown === undefined) unknown = [paths[i], paths[i + 1]];
    }
    if (unknown !== undefined) return { score: null, valid: false, steps, unknown };
    if (truth.shortest === null) return { score: 0, valid: true, steps, problem: "a valid cycle, though the truth says none: recheck the truth" };
    if (steps < truth.shortest) return { score: 1, valid: true, steps, problem: "shorter than the truth's shortest: recheck the truth" };
    return { score: steps === truth.shortest ? 1 : 0.5, valid: true, steps };
}

export const scoreCycle = (paths: readonly string[] | "none", truth: CycleTruth, imports: (a: string, b: string) => boolean | null): number | null => checkCycle(paths, truth, imports).score;
