/**
 * npm run eval:draw -- --eval <dir>
 *
 * The seeded draw of Eval #3's questions (design §5.4, step 3). Each call or task candidate in <dir>/candidates.json gets its
 * truth's size from TypeScript's checker (ts-calls.ts, one program per repo), and passes when its size is 10-80 files, it
 * isn't a planning method (R-A), and it shares no target with the dev set or with the questions of the sessions Eval #3
 * reuses (overlap.ts). A graph candidate brings its size and its pass from Step 3's ranges, and is checked for overlap
 * too. Then, per repo and kind, in the order breaks, task, callers, adopt, injects and the graph kinds, n of
 * the passing candidates are drawn: sorted by id, shuffled with mulberry32(1), the first n. A type drawn once leaves the
 * repo's later pools (R-AF). It writes the sizes, the verdicts and the draw back into candidates.json. Nobody sees how
 * either arm does on a candidate before this runs. Imports nothing from lib/.
 *
 * Where the candidates live: <dir>/candidates.json holds the call and task candidates (and any graph candidates small enough
 * to sit inline). A repo's graph candidates, every qualifying target of Step 3's ranges (Theia's are 46,929), are a read-only
 * input in <dir>/candidates-<repo>-graph.json.gz, one JSON candidate per line. The draw never writes them back: candidates.json
 * gains a `graphDraw` object (per repo and graph kind: pool, passing, the drawn ids) and `graphDrawn`, the full record of
 * each drawn graph candidate, so a question can be built from candidates.json alone.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { loadDefinition } from "./definition";
import { askedOfQuestion, askedOfSpec, overlaps, type Asked } from "./overlap";
import { mulberry32 } from "./stats";
import { callTruth, programFor, type CallTarget, type CallTruthKind } from "./ts-calls";

export function draw<T extends { id: string }>(candidates: readonly T[], n: number, seed: number): T[] {
    const pool = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const random = mulberry32(seed);
    for (let i = pool.length - 1; i > 0; i--){
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

/** R-A: the planning targets stay out of Eval #3 (VS Code's five, AFFiNE's three), as Type.member. */
export const PLANNING: readonly string[] = [
    "IFileService.readFile", "IStorageService.store", "IConfigurationService.getValue", "ICommandService.executeCommand", "IEditorService.openEditor",
    "WorkspaceDialogService.open", "GraphQLService.gql", "GlobalDialogService.open",
];

export const MIN_SIZE = 10;
export const MAX_SIZE = 80;

export type Candidate = {
    id: string; repo: string; kind: string; target?: Record<string, unknown>; change?: string;
    source: string; quote: string; truthSize?: number; passes?: boolean; why?: string; drawn?: boolean;
};

const CALL_KINDS = ["callers", "breaks", "adopt", "injects", "task"];
/** The order of the draw (R-AF): the call kinds first, then the graph kinds. */
export const DRAW_ORDER = ["breaks", "task", "callers", "adopt", "injects", "list-direct", "list-transitive", "chain", "cycle", "unused", "entries"];
/** D2's mix: how many questions of each kind a repo asks (the sessions' and the reused questions apart). */
export const MIX: Record<string, Record<string, number>> = {
    vscode: { callers: 2, breaks: 2, adopt: 1, injects: 1, task: 3 },
    affine: { callers: 1, breaks: 2, adopt: 1, injects: 1, task: 3 },
    theia: { callers: 1, breaks: 2, injects: 1, task: 2, "list-direct": 1, "list-transitive": 1, chain: 1, cycle: 1, unused: 1, entries: 1 },
};

export const isPlanning = (target: { type?: unknown; member?: unknown } | undefined): boolean =>
    target !== undefined && typeof target.type === "string" && typeof target.member === "string" && PLANNING.includes(`${target.type}.${target.member}`);

export const sizeInRange = (size: number): boolean => size >= MIN_SIZE && size <= MAX_SIZE;

/** The type a candidate names, or null (a graph candidate): R-AF's key. */
const typeOf = (c: Candidate): string | null => (typeof c.target?.type === "string" ? c.target.type : null);

/** A gzipped (or plain) text of one JSON candidate per line, blank lines ignored. */
export function parseJsonLines(text: string): Candidate[] {
    return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Candidate);
}

export type GraphDraw = { pool: number; passing: number; drawn: string[]; replaced?: string[] };

/** A repo's graph kinds from the draw's rows: the pool, the passing count and the drawn ids of each, the ids sorted. */
export function graphDrawOf(rows: readonly DrawRow[], drawn: readonly Candidate[]): Record<string, GraphDraw> {
    const out: Record<string, GraphDraw> = {};
    for (const r of rows) if (GRAPH_KINDS.includes(r.kind)) out[r.kind] = { pool: r.candidates, passing: r.passing, drawn: drawn.filter((c) => c.kind === r.kind).map((c) => c.id).sort() };
    return out;
}

export type DrawRow = { kind: string; candidates: number; passing: number; drawn: number };

/**
 * One repo's draw, over its candidates (which already carry `passes`): the kinds in DRAW_ORDER, n each by `mix`, a type drawn
 * once leaving the later pools (R-AF); R-X: an adopt pool with nothing passing draws the adopt's count of callers instead.
 */
export function drawRepo(candidates: readonly Candidate[], mix: Record<string, number>, seed: number): { drawn: Candidate[]; rows: DrawRow[]; notes: string[] } {
    const drawn: Candidate[] = [];
    const rows: DrawRow[] = [];
    const notes: string[] = [];
    const used = new Set<string>();
    const take = (kind: string, n: number): number => {
        const all = candidates.filter((c) => c.kind === kind);
        const pool = all.filter((c) => c.passes === true && (typeOf(c) === null || !used.has(typeOf(c)!)));
        const picked = draw(pool, n, seed);
        for (const c of picked){ drawn.push(c); const t = typeOf(c); if (t !== null) used.add(t); }
        rows.push({ kind, candidates: all.length, passing: pool.length, drawn: picked.length });
        return picked.length;
    };
    let extraCallers = 0;
    for (const kind of DRAW_ORDER){
        const want = mix[kind] ?? 0;
        if (kind === "callers") take(kind, want);
        else if (kind === "adopt" && want > 0){
            const got = take(kind, want);
            if (got === 0){
                extraCallers = want;
                notes.push(`R-X: no passing adopt candidate; ${want} more callers question${want === 1 ? "" : "s"} drawn instead.`);
                const more = take("callers", extraCallers);
                if (more < extraCallers) notes.push(`R-X: only ${more} of the ${extraCallers} extra callers drawn.`);
            }
        } else if (want > 0) take(kind, want);
        if (want > 0 && kind !== "adopt" && rows[rows.length - 1].drawn < want) notes.push(`${kind}: ${rows[rows.length - 1].drawn} of ${want} drawn.`);
    }
    return { drawn, rows, notes };
}

export const GRAPH_KINDS = ["list-direct", "list-transitive", "chain", "cycle", "unused", "entries"];
const SIZED_AS: Record<string, CallTruthKind> = { callers: "callers", adopt: "callers", breaks: "breaks", task: "breaks", injects: "injects" };

function main(): void {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--eval"){
        console.error("usage: npm run eval:draw -- --eval <dir>");
        process.exitCode = 1;
        return;
    }
    const root = path.resolve(__dirname, "..", "..");
    const dir = path.resolve(root, argv[1]);
    const definition = loadDefinition(dir);
    const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON read field by field
    const candidatesFile = path.join(dir, "candidates.json");
    const file = readJson(candidatesFile) as { candidates: Candidate[]; graphDraw?: unknown; graphDrawn?: unknown };
    const inline = file.candidates;
    // graph candidates kept out of candidates.json: read-only gzipped inputs, one per repo
    const graphInputs = fs.readdirSync(dir).filter((name) => /^candidates-.+-graph.json.gz$/.test(name)).sort();
    const external = graphInputs.flatMap((name) => parseJsonLines(zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).toString("utf8")));
    const candidates = [...inline, ...external];

    // what a candidate may not share a target with: the dev set, and the questions of the two sessions Eval #3 reuses
    const readTruth = (truth: string): Record<string, unknown> | null => {
        const p = path.resolve(root, truth);
        return fs.existsSync(p) ? readJson(p) : null;
    };
    const dev: Asked[] = (readJson(path.join(dir, "dev", "questions.json")).questions as { id: string; repo?: string }[]).map((q) => askedOfQuestion(q, undefined));
    const reused = new Set(["vscode-s1", "affine-s1"]);
    const sessionQuestions = (readJson(path.join(root, "eval2", "questions.json")).questions as { id: string; repo?: string; session?: string }[])
        .filter((q) => q.session !== undefined && reused.has(q.session))
        .map((q) => askedOfQuestion(q, undefined, readTruth));
    const avoid = [...dev, ...sessionQuestions];

    // one checker program per repo that has call or task candidates
    const programs = new Map<string, ReturnType<typeof programFor>>();
    const programOf = (repo: string): ReturnType<typeof programFor> => {
        if (!programs.has(repo)){
            const def = definition.repos[repo];
            if (!def) throw new Error(`${repo} isn't in ${argv[1]}/eval.json`);
            programs.set(repo, programFor(path.resolve(root, def.path), { project: def.project }));
        }
        return programs.get(repo)!;
    };

    for (const c of candidates){
        const reasons: string[] = [];
        if (CALL_KINDS.includes(c.kind)){
            const target = c.target as CallTarget | undefined;
            if (!target) { c.passes = false; c.why = "no target"; continue; }
            try {
                const { program } = programOf(c.repo);
                c.truthSize = callTruth(program, path.resolve(root, definition.repos[c.repo].path), SIZED_AS[c.kind], target).files.length;
            } catch (error){
                c.truthSize = undefined;
                reasons.push(`no truth: ${(error as Error).message}`);
            }
            if (c.truthSize !== undefined && !sizeInRange(c.truthSize)) reasons.push(`size ${c.truthSize} outside ${MIN_SIZE}-${MAX_SIZE}`);
            if (isPlanning(target)) reasons.push("a planning method (R-A)");
        } else if (!GRAPH_KINDS.includes(c.kind)){
            c.passes = false; c.why = `unknown kind ${c.kind}`; continue;
        }
        const fields = { id: c.id, repo: c.repo, ...(c.target ?? {}), kind: c.target?.kind ?? c.kind } as Parameters<typeof askedOfSpec>[0];
        for (const line of overlaps([askedOfSpec(fields)], avoid)) reasons.push(`overlap: ${line}`);
        if (CALL_KINDS.includes(c.kind)){
            c.passes = reasons.length === 0;
            c.why = reasons.length === 0 ? undefined : reasons.join("; ");
        } else if (reasons.length > 0){
            c.passes = false; // a graph candidate keeps its pass unless it overlaps
            c.why = reasons.join("; ");
        } else if (c.why?.startsWith("overlap")){
            c.passes = true; // an earlier run's overlap that no longer holds
            c.why = undefined;
        }
    }

    const repos = [...new Set(candidates.map((c) => c.repo))];
    const graphDraw: Record<string, Record<string, GraphDraw>> = {};
    console.log("repo     kind             candidates  passing  drawn");
    for (const c of candidates) c.drawn = false;
    for (const repo of repos){
        const result = drawRepo(candidates.filter((c) => c.repo === repo), MIX[repo] ?? {}, 1);
        for (const c of result.drawn) c.drawn = true;
        const graph = graphDrawOf(result.rows, result.drawn);
        if (Object.keys(graph).length > 0) graphDraw[repo] = graph;
        for (const r of result.rows) console.log(`${repo.padEnd(8)} ${r.kind.padEnd(16)} ${String(r.candidates).padStart(10)}  ${String(r.passing).padStart(7)}  ${String(r.drawn).padStart(5)}`);
        for (const note of result.notes) console.log(`${repo}: ${note}`);
    }
    const kept = new Set(external);
    const graphDrawn = candidates.filter((c) => kept.has(c) && c.drawn === true);
    fs.writeFileSync(candidatesFile, JSON.stringify({ ...file, candidates: inline, graphDraw, graphDrawn }, null, 2) + "\n");
}

// runs only as a script, so the tests can import the functions above
if (/[\\/]draw\.ts$/.test(process.argv[1] ?? "")) main();
