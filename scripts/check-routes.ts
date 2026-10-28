/**
 * npm run check-routes -- <path-to-repo> [--per-row 6] [--folder <path>] [--examples 5]
 *
 * Routes every page of every folder of an indexed repo the way the Map does (level(), layoutLevel, routeEdges), in two
 * states: at rest (the lines drawn with Strong links only on and nothing selected, hovered or lit, a busy level's lines
 * quiet) and with every line drawn. In each it counts the routing faults the owner flags (route-faults.ts): two lines
 * sharing a run, a sideways step under 24 px, one line's drop ending just above where another's starts, and a line
 * through another's arrowhead. So a regression shows up across a whole repo, not only in routes.test.ts's levels.
 *
 * For each state it prints the counts, an example from each of the first few pages with each fault, the slowest pages
 * to route and the pages with the most faults (at rest, every page with one). It exits 1 when any page has a fault at
 * rest. `--folder` checks only that folder and the ones under it. It reads the index under NEBULOSITY_DATA (by default
 * the checkout's .nebulosity) and writes nothing.
 */
import path from "path";
import type { LevelResponse } from "../lib/contracts";
import { getDb, useReadOnlyDatabase } from "../lib/db/client";
import { requireRepository } from "../lib/db/store/structure";
import { loadFolderFacts } from "../lib/db/store/summaries";
import { level } from "../lib/engine/level";
import { repoKey } from "../lib/index/paths";
import { layoutLevel, LAYOUT_MAX_LINES, MAX_PER_ROW } from "../app/map/levelLayout";
import { routeEdges } from "../app/map/routes";
import { drawnAtRest, FAULT_KINDS, routeFaults, widthsOf, type FaultKind } from "./route-faults";

const USAGE = "usage: npm run check-routes -- <path-to-repo> [--per-row 6] [--folder <path>] [--examples 5]";
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
};
const target = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const perRow = Number(option("--per-row") ?? MAX_PER_ROW);
const shown = Number(option("--examples") ?? 5);
const under = option("--folder");
if (!target || !Number.isInteger(perRow) || perRow < 1 || !Number.isInteger(shown) || shown < 0){
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
/** With every line drawn, the pages with the most faults listed; at rest, where there should be none, all of them. */
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
    const where = placeOf(lvl);
    for (const [state, drawn] of [["at rest", drawnAtRest(lvl)], ["every line", undefined]] as const){
        const tally = tallies[state];
        const before = performance.now();
        const routes = routeEdges(positions, lvl.edges, drawn);
        const ms = performance.now() - before;
        tally.ms += ms;
        tally.lines += routes.size;
        if (routes.size === 0) continue;
        tally.pagesWithLines++;
        tally.timings.push({ where, lines: routes.size, ms });
        const faults = routeFaults(routes, widths);
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
}

for (const folder of folders){
    const first = level(root, folder, { summariesOff: true });
    check(first);
    for (let page = 1; page < first.pageCount; page++) check(level(root, folder, { summariesOff: true, page }));
}
const took = performance.now() - started;

const n = (x: number): string => x.toLocaleString("en-US");
const pages = (x: number): string => `${n(x)} ${x === 1 ? "page" : "pages"}`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const out = (line: string): void => console.log(`[check-routes] ${line}`);

out(`${root}${under ? `, ${under} and under it` : ""}: ${n(folders.length)} folders, ${pages(pageTotal)}, ${perRow} a row, checked in ${seconds(took)}`);
for (const state of ["at rest", "every line"] as const){
    const t = tallies[state];
    out(`${state}: ${n(t.lines)} lines on ${pages(t.pagesWithLines)}, routed in ${seconds(t.ms)}`);
    for (const kind of FAULT_KINDS){
        out(`  ${LABEL[kind]}: ${n(t.faults[kind])}${t.faults[kind] > 0 ? ` on ${pages(t.pagesWith[kind])}` : ""}`);
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

const atRest = tallies["at rest"].faulty;
const atRestTotal = atRest.reduce((sum, p) => sum + p.total, 0);
out(`at rest: ${atRestTotal === 0 ? "no faults, PASS" : `${n(atRestTotal)} faults on ${pages(atRest.length)}, FAIL`}`);
if (atRestTotal > 0) process.exitCode = 1;
