/**
 * npm run check-routes -- <path-to-repo> [--per-row 6] [--folder <path>] [--examples 5] [--walk hover|light]
 *
 * Routes every page of every folder of an indexed repo the way the Map does (level(), layoutLevel, routeEdges), in two
 * states: at rest (the lines drawn with Strong links only on and nothing selected, hovered or lit, a busy level's lines
 * quiet) and with every line drawn. In each it counts the routing faults the owner flags (route-faults.ts): two lines
 * sharing a run, a sideways step under 24 px, one line's drop ending just above where another's starts, and a line
 * through a box's arrowhead. Lines that share an end merge, so two that do are judged past the stretch they share, and
 * the lines into a box share its head. So a regression shows up across a whole repo, not only in routes.test.ts's levels.
 *
 * For each state it prints the counts (at rest, each beside its bar), an example from each of the first few pages with
 * each fault, the slowest pages to route and the pages with the most faults (at rest, every page with one).
 * `--walk hover` then points at every linked box of every page from rest and leaves it, and `--walk light` also selects
 * each linked box and points at each box it has a line to, routing each step as MapCanvas does, from what's on screen
 * (nextRoutes). A walk prints its steps, how many drawn lines moved, its slowest step and its faults over the steps.
 * It exits 1 when a kind of fault at rest is over its bar or a walk moves a drawn line. `--folder` checks only that
 * folder and the ones under it. It reads the index under NEBULOSITY_DATA (by default the checkout's .nebulosity) and
 * writes nothing.
 */
import path from "path";
import type { LevelResponse } from "../lib/contracts";
import { getDb, useReadOnlyDatabase } from "../lib/db/client";
import { requireRepository } from "../lib/db/store/structure";
import { loadFolderFacts } from "../lib/db/store/summaries";
import { level } from "../lib/engine/level";
import { repoKey } from "../lib/index/paths";
import { layoutLevel, LAYOUT_MAX_LINES, MAX_PER_ROW, type Position } from "../app/map/levelLayout";
import { nextRoutes, routeEdges, type Point } from "../app/map/routes";
import { drawnAt, endsOf, FAULT_KINDS, headsOf, routeFaults, widthsOf, type Fault, type FaultKind } from "./route-faults";

const USAGE = "usage: npm run check-routes -- <path-to-repo> [--per-row 6] [--folder <path>] [--examples 5] [--walk hover|light]";
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
};
const target = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const perRow = Number(option("--per-row") ?? MAX_PER_ROW);
const shown = Number(option("--examples") ?? 5);
const under = option("--folder");
const walk = option("--walk");
// a bare --walk would read as no walk and pass unwalked, so it needs one of its two values
if (!target || !Number.isInteger(perRow) || perRow < 1 || !Number.isInteger(shown) || shown < 0 || (args.includes("--walk") && walk !== "hover" && walk !== "light")){
    console.error(USAGE);
    process.exit(1);
}

const LABEL: Record<FaultKind, string> = {
    shared: "two lines sharing a run",
    jog: "sideways steps under 24 px",
    lined: "lines in line end to end",
    head: "lines through an arrowhead",
};
const SHORT: Record<FaultKind, string> = { shared: "shared runs", jog: "wiggles", lined: "end to end", head: "through a head" };
/**
 * The most of each kind a router may leave at rest: main's own counts over all of VS Code at 0063e4c, under PR #17's
 * rules (1,251 in all on 56 pages), for shared runs, wiggles and lines end to end, where a bar of zero would fail on
 * crowded channels that merging can't clear. Heads are held to zero (the owner, 2026-10-28): main's 243 were all two
 * lines into one box, which now share its head, so main and the merged router both score none, and any line through an
 * arrowhead at rest is a regression.
 */
const BAR: Record<FaultKind, number> = { shared: 909, jog: 31, lined: 68, head: 0 };
/** With every line drawn, the pages with the most faults listed; at rest, all of them. */
const WORST = 10;
const SLOWEST = 5;

type State = "at rest" | "every line";
type PageFaults = { where: string; counts: Record<FaultKind, number>; total: number };
type Tally = {
    lines: number;
    pagesWithLines: number;
    ms: number;
    faults: Record<FaultKind, number>;
    pagesWith: Record<FaultKind, number>;
    examples: Record<FaultKind, string[]>;
    faulty: PageFaults[];
    timings: { where: string; lines: number; ms: number }[];
};
const byKind = <T>(make: (kind: FaultKind) => T): Record<FaultKind, T> => Object.fromEntries(FAULT_KINDS.map((k) => [k, make(k)])) as Record<FaultKind, T>;
const newTally = (): Tally => ({
    lines: 0, pagesWithLines: 0, ms: 0, faults: byKind(() => 0), pagesWith: byKind(() => 0), examples: byKind((): string[] => []), faulty: [], timings: [],
});
/** A walk's steps over every page, the drawn lines that moved, and the faults on the steps that weren't back at rest. */
const walked = {
    steps: 0,
    ms: 0,
    slowest: { where: "", ms: 0 },
    moved: 0,
    movedAt: [] as string[],
    faultSteps: 0,
    faults: byKind(() => 0),
    stepsWith: byKind(() => 0),
};

const root = path.resolve(target);
// eslint-disable-next-line react-hooks/rules-of-hooks -- a database mode switch, not a React hook; the name only starts with "use"
useReadOnlyDatabase();
const db = getDb();
const repoId = requireRepository(db, repoKey(root));
const folders = loadFolderFacts(db, repoId).map((f) => f.path)
    .filter((p) => under === undefined || under === "" || p === under || p.startsWith(`${under}/`));
if (folders.length === 0){
    console.error(`[check-routes] no folder "${under}" in ${root}'s index`);
    process.exit(1);
}

const tallies: Record<State, Tally> = { "at rest": newTally(), "every line": newTally() };
const started = performance.now();
let pageTotal = 0;

/** Where a page is, as the Map's address bar and page pill name it. */
const placeOf = (lvl: LevelResponse): string => `${lvl.path === "" ? "(root)" : lvl.path}${lvl.pageCount > 1 ? ` page ${lvl.page + 1} of ${lvl.pageCount}` : ""}`;

function check(lvl: LevelResponse): void {
    pageTotal++;
    const positions = layoutLevel(lvl.nodes, lvl.edges, LAYOUT_MAX_LINES, perRow);
    const widths = widthsOf(lvl.edges);
    const ends = endsOf(lvl.edges);
    const heads = headsOf(lvl.edges);
    const faultsOf = (routes: ReadonlyMap<string, Point[]>): Record<FaultKind, Fault[]> => routeFaults(routes, widths, ends, heads);
    const where = placeOf(lvl);
    let rest = new Map<string, Point[]>();
    for (const [state, drawn] of [["at rest", drawnAt(lvl)], ["every line", undefined]] as const){
        const tally = tallies[state];
        const before = performance.now();
        const routes = routeEdges(positions, lvl.edges, drawn);
        const ms = performance.now() - before;
        if (state === "at rest") rest = routes;
        tally.ms += ms;
        tally.lines += routes.size;
        if (routes.size === 0) continue;
        tally.pagesWithLines++;
        tally.timings.push({ where, lines: routes.size, ms });
        const faults = faultsOf(routes);
        const counts = byKind((k) => faults[k].length);
        const total = FAULT_KINDS.reduce((sum, k) => sum + counts[k], 0);
        if (total === 0) continue;
        tally.faulty.push({ where, counts, total });
        for (const kind of FAULT_KINDS){
            const [first] = faults[kind];
            if (first === undefined) continue;
            tally.faults[kind] += counts[kind];
            tally.pagesWith[kind]++;
            // one example a page, so they show where the faults are rather than one page's many
            if (tally.examples[kind].length < shown) tally.examples[kind].push(`${where}: ${first.lines.join(" and ")}, ${first.detail}`);
        }
    }
    if (walk !== undefined) walkPage(lvl, positions, rest, faultsOf, where);
}

/** A walk's steps on a page, each what's selected and what's under the pointer, every one from rest and back to it. */
function stepsOf(lvl: LevelResponse): [string | null, string | null][] {
    const linked = lvl.nodes.map((n) => n.path).filter((box) => lvl.edges.some((e) => e.source !== e.target && (e.source === box || e.target === box)));
    const found: [string | null, string | null][] = [];
    for (const box of linked) found.push([null, box], [null, null]);
    if (walk !== "light") return found;
    for (const box of linked){
        found.push([box, null]);
        const near = new Set(lvl.edges.flatMap((e) => (e.source === e.target ? [] : e.source === box ? [e.target] : e.target === box ? [e.source] : [])));
        for (const other of near) found.push([box, other], [box, null]);
        found.push([null, null]);
    }
    return found;
}

/**
 * Takes a page through its walk the way MapCanvas redraws: the rest routes once, then each step's from what's on
 * screen. A line drawn in the step before and in this one has moved when its route isn't the very one it had.
 */
function walkPage(
    lvl: LevelResponse,
    positions: ReadonlyMap<string, Position>,
    rest: ReadonlyMap<string, Point[]>,
    faultsOf: (routes: ReadonlyMap<string, Point[]>) => Record<FaultKind, Fault[]>,
    where: string,
): void {
    let before = rest;
    let drawnBefore = drawnAt(lvl);
    for (const [selected, hovered] of stepsOf(lvl)){
        const drawn = drawnAt(lvl, selected, hovered);
        const stepStart = performance.now();
        const routes = nextRoutes(positions, lvl.edges, rest, before, drawn);
        const ms = performance.now() - stepStart;
        const step = `${where} (${selected ?? "nothing"} selected, ${hovered ?? "nothing"} under the pointer)`;
        walked.steps++;
        walked.ms += ms;
        if (ms > walked.slowest.ms) walked.slowest = { where: step, ms };
        for (const key of drawn){
            if (!drawnBefore.has(key) || routes.get(key) === before.get(key)) continue;
            walked.moved++;
            if (walked.movedAt.length < shown) walked.movedAt.push(`${step}: ${key}`);
        }
        // a step back to rest draws the rest routes again, whose faults are counted at rest
        if (selected !== null || hovered !== null){
            walked.faultSteps++;
            const faults = faultsOf(routes);
            for (const kind of FAULT_KINDS){
                walked.faults[kind] += faults[kind].length;
                if (faults[kind].length > 0) walked.stepsWith[kind]++;
            }
        }
        before = routes;
        drawnBefore = drawn;
    }
}

for (const folder of folders){
    const first = level(root, folder, { summariesOff: true });
    check(first);
    for (let page = 1; page < first.pageCount; page++) check(level(root, folder, { summariesOff: true, page }));
}
const took = performance.now() - started;

const n = (x: number): string => x.toLocaleString("en-US");
const pages = (x: number): string => `${n(x)} ${x === 1 ? "page" : "pages"}`;
const steps = (x: number): string => `${n(x)} ${x === 1 ? "step" : "steps"}`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const out = (line: string): void => console.log(`[check-routes] ${line}`);

out(`${root}${under ? `, ${under} and under it` : ""}: ${n(folders.length)} folders, ${pages(pageTotal)}, ${perRow} a row, checked in ${seconds(took)}`);
for (const state of ["at rest", "every line"] as const){
    const t = tallies[state];
    out(`${state}: ${n(t.lines)} lines on ${pages(t.pagesWithLines)}, routed in ${seconds(t.ms)}`);
    for (const kind of FAULT_KINDS){
        const bar = state === "at rest" ? `, bar ${n(BAR[kind])}${t.faults[kind] > BAR[kind] ? ", over it" : ""}` : "";
        out(`  ${LABEL[kind]}: ${n(t.faults[kind])}${t.faults[kind] > 0 ? ` on ${pages(t.pagesWith[kind])}` : ""}${bar}`);
        for (const example of t.examples[kind]) out(`    ${example}`);
    }
    out(`  slowest to route:`);
    for (const s of [...t.timings].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST)) out(`    ${s.where}: ${n(s.lines)} lines in ${s.ms.toFixed(0)} ms`);
    if (t.faulty.length === 0) continue;
    const worst = [...t.faulty].sort((a, b) => b.total - a.total || (a.where < b.where ? -1 : 1));
    const listed = state === "at rest" ? worst : worst.slice(0, WORST);
    out(`  ${listed.length < worst.length ? `the ${listed.length} of ${pages(worst.length)} with the most faults` : `${pages(worst.length)} with a fault`}:`);
    for (const p of listed) out(`    ${p.where}: ${n(p.total)} (${FAULT_KINDS.filter((k) => p.counts[k] > 0).map((k) => `${SHORT[k]} ${n(p.counts[k])}`).join(", ")})`);
}
if (walk !== undefined){
    out(`walk ${walk}: ${steps(walked.steps)}, routed in ${seconds(walked.ms)}${walked.steps > 0 ? `, slowest ${walked.slowest.ms.toFixed(0)} ms, ${walked.slowest.where}` : ""}`);
    out(`  drawn lines moved: ${n(walked.moved)}`);
    for (const m of walked.movedAt) out(`    ${m}`);
    out(`  faults over the ${steps(walked.faultSteps)} with something selected or under the pointer:`);
    for (const kind of FAULT_KINDS) out(`    ${LABEL[kind]}: ${n(walked.faults[kind])}${walked.faults[kind] > 0 ? ` on ${steps(walked.stepsWith[kind])}` : ""}`);
}

const atRest = tallies["at rest"];
const atRestTotal = atRest.faulty.reduce((sum, p) => sum + p.total, 0);
const over = FAULT_KINDS.filter((k) => atRest.faults[k] > BAR[k]);
const kinds = FAULT_KINDS.map((k) => `${SHORT[k]} ${n(atRest.faults[k])} of ${n(BAR[k])}`).join(", ");
out(`at rest: ${n(atRestTotal)} faults on ${pages(atRest.faulty.length)} (${kinds}), ${over.length === 0 ? "no kind over its bar, PASS" : `${over.map((k) => SHORT[k]).join(" and ")} over the bar, FAIL`}`);
if (walk !== undefined) out(`walk ${walk}: ${walked.moved === 0 ? "no drawn line moved, PASS" : `${n(walked.moved)} drawn lines moved, FAIL`}`);
if (over.length > 0 || walked.moved > 0) process.exitCode = 1;
