import type { AreaCount, DescribeResponse, DocPointer, SearchResult } from "../contracts";
import { RARE_PAIR, type ArchitectureAnswer, type Conventions, type Layers, type Part, type Unused } from "../engine/architecture";
import type { Impact, Roots } from "../engine/impact";
import type { Overview } from "../engine/overview";
import { FILE_CHUNK } from "../engine/rank";
import type { ChainAnswer, ReachAnswer } from "../engine/reach";
import { plural } from "../index/summarize/prompts";
import { fitting, formatCount, MAX_ANSWER_CHARS, moreLine, shownPath, summaryLine, type AnswerParts } from "./text";

/** How much of each list an answer shows; the counts above a list are always whole (ADR-047). */
export const SHOWN = { areas: 30, children: 20, declarations: 30, linkedAreas: 10 } as const;
/** A search hit's best code, cut to this many characters. */
export const SNIPPET_CHARS = 160;
/** Room kept inside MAX_ANSWER_CHARS for a reach answer's distance headings, page line, cut line and notes. */
const REACH_HEADROOM = 2_000;

/** dependents and dependencies list a page: everything reached, or only the direct files. */
export type ReachPage = { transitive: boolean; limit: number; offset: number };

/** "Docs about it:" or "Docs to read first:": one line per doc, its path, its title, and why (ADR-054). */
function docLines(header: string, docs: readonly DocPointer[] | undefined, here: { path: string; kind: "repo" | "folder" | "file" }): string[] {
    if (!docs || docs.length === 0) return [];
    const why = (r: NonNullable<DocPointer["reason"]>): string => {
        if (r.kind === "applies") return `applies to ${r.detail ?? `${r.target}/`}`;
        if (r.kind === "readme") return r.target === here.path ? "this folder's README" : r.target === "" ? "the repo's README" : `README of ${r.target}/`;
        const shown = r.target === here.path && here.kind === "file" ? r.target : `${r.target}/`;
        return `mentions ${shown}${r.count > 1 ? ` (${r.count} times)` : ""}`;
    };
    return [header, ...docs.map((d) => `  ${d.path} — ${d.title}${d.reason ? ` (${why(d.reason)})` : ""}`)];
}

export function overviewAnswer(o: Overview): AnswerParts {
    const body = [
        `${o.name}: ${plural(o.stats.fileCount, "file")}, ${plural(o.stats.lineCount, "line")}, ${plural(o.stats.importCount, "import")} between files.`,
        summaryLine(o),
        ...docLines("Docs to read first:", o.docs, { path: "", kind: "repo" }),
    ];
    if (o.areas.length > 0){
        body.push("Areas, largest first:");
        for (const area of o.areas.slice(0, SHOWN.areas)){
            const size = area.kind === "folder" ? `${plural(area.fileCount, "file")}, ${plural(area.lineCount, "line")}` : plural(area.lineCount, "line");
            body.push(`  ${shownPath(area.path, area.kind)}  ${size}${area.tagline ? ` — ${area.tagline}` : ""}`);
        }
        if (o.areas.length > SHOWN.areas) body.push(`  ${moreLine(o.areas.length - SHOWN.areas)}`);
    }
    if (o.mostImported.length > 0){
        body.push("Most imported files:");
        for (const f of o.mostImported) body.push(`  ${f.path}  imported by ${formatCount(f.importedBy)}`);
    }
    return { body, stale: o.stalePaths };
}

export function describeAnswer(d: DescribeResponse, repoName: string): AnswerParts {
    const size = `${plural(d.stats.fileCount, "file")}, ${plural(d.stats.lineCount, "line")}`;
    const body = [
        d.kind === "repo" ? `${repoName} — the whole repo: ${size}.`
            : d.kind === "folder" ? `${d.path}/ — folder: ${size}.`
            : `${d.path} — file: ${plural(d.stats.lineCount, "line")}.`,
        summaryLine(d),
        ...docLines(d.kind === "repo" ? "Docs to read first:" : "Docs about it:", d.docs, { path: d.path, kind: d.kind }),
    ];

    if (d.children){
        body.push(`Inside (${formatCount(d.children.length)}):`);
        for (const child of d.children.slice(0, SHOWN.children)){
            const label = child.kind === "folder" ? `${child.name}/  ${plural(child.fileCount, "file")}` : child.name;
            body.push(`  ${label}${child.tagline ? ` — ${child.tagline}` : ""}`);
        }
        if (d.children.length > SHOWN.children) body.push(`  ${moreLine(d.children.length - SHOWN.children)}`);
    }

    if (d.symbols){
        if (d.importsOnly) body.push("Declarations: not read (over the 1 MB size cap; imports only).");
        else if (d.symbols.length === 0) body.push("Declarations: none.");
        else{
            body.push(`Declarations (${formatCount(d.symbols.length)}):`);
            for (const s of d.symbols.slice(0, SHOWN.declarations)){
                const lines = s.startLine === s.endLine ? `${s.startLine}` : `${s.startLine}–${s.endLine}`;
                body.push(`  ${lines}  ${s.kind} ${s.name}${s.exported ? "" : " (not exported)"}`);
            }
            if (d.symbols.length > SHOWN.declarations) body.push(`  ${moreLine(d.symbols.length - SHOWN.declarations)}`);
        }
    }

    // the whole repo has no outside
    if (d.kind !== "repo") body.push(...linkedAreas("Uses", d.uses), ...linkedAreas("Used by", d.usedBy));
    return { body, stale: d.stalePaths };
}

function linkedAreas(label: string, areas: readonly AreaCount[]): string[] {
    if (areas.length === 0) return [`${label}: nothing outside it.`];
    const imports = areas.reduce((sum, area) => sum + area.count, 0);
    const lines = [`${label} (${plural(imports, "import")}):`];
    for (const area of areas.slice(0, SHOWN.linkedAreas)) lines.push(`  ${shownPath(area.path, area.kind)}  ${formatCount(area.count)}`);
    if (areas.length > SHOWN.linkedAreas) lines.push(`  ${moreLine(areas.length - SHOWN.linkedAreas)} areas`);
    return lines;
}

export function searchAnswer(r: SearchResult): AnswerParts {
    const notes = r.note ? [r.note] : [];
    if (r.hits.length === 0) return { body: [`No files or folders match "${r.query}". Try other words; for an exact string, use Grep.`], notes };

    const body = [`Search "${r.query}": ${plural(r.hits.length, "best match", "best matches")}.`];
    r.hits.forEach((hit, i) => {
        body.push(`${String(i + 1).padStart(2)}. ${shownPath(hit.path, hit.kind)}${hit.tagline ? ` — ${hit.tagline}` : ""}`);
        if (hit.code){
            const lines = hit.code.startLine === hit.code.endLine ? `line ${hit.code.startLine}` : `lines ${hit.code.startLine}–${hit.code.endLine}`;
            const where = hit.code.symbol === FILE_CHUNK ? "imports and exports" : `${hit.code.symbol}, ${lines}`;
            body.push(`    ${where}: ${clip(hit.code.snippet, SNIPPET_CHARS)}`);
        }
    });
    return { body, notes };
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The first line of a dependents or dependencies answer; with `within`, it says which folder is counted. */
export function reachHeader(a: ReachAnswer): string {
    const target = shownPath(a.path, a.kind);
    if (a.reached.length === 0){
        if (a.within !== undefined){
            return a.direction === "dependents" ? `No file inside ${a.within}/ imports ${target}.` : `${target} imports no file inside ${a.within}/.`;
        }
        return a.direction === "dependents"
            ? (a.kind === "folder" ? `Nothing outside ${target} imports it.` : `Nothing imports ${target}.`)
            : (a.kind === "folder" ? `${target} imports nothing outside it.` : `${target} imports no other indexed file.`);
    }
    const total = a.reached.length;
    const header = a.direction === "dependents"
        ? `${target} is imported${a.kind === "folder" ? " from outside it" : ""} by ${plural(a.direct, "file")} directly and ${plural(total, "file")} in all, counting files that reach it through others.`
        : `${target} imports ${plural(a.direct, "file")}${a.kind === "folder" ? " outside it" : ""} directly and ${plural(total, "file")} in all, counting what those import in turn.`;
    return a.within !== undefined ? `${header} Only files inside ${a.within}/ are counted.` : header;
}

/** `after` is appended at the very end of the body (rootLines, for dependents); its size is taken out of the list's budget. */
export function reachAnswer(a: ReachAnswer, page: ReachPage, after: readonly string[] = []): AnswerParts {
    const total = a.reached.length;
    const body = [reachHeader(a)];
    if (total === 0) return { body };

    // reached is nearest first, so the direct files lead it
    const listed = page.transitive ? a.reached : a.reached.slice(0, a.direct);
    if (!page.transitive && a.direct === 0){
        // a within list can hold no direct file (the rest reach it through others): the offset message would call it empty
        body.push(a.direction === "dependents" ? "None of them imports it directly; list them with transitive." : "It imports none of them directly; list them with transitive.");
        return { body };
    }
    if (page.offset >= listed.length){
        body.push(`Nothing at offset ${page.offset}: the list has ${formatCount(listed.length)}.`);
        return { body };
    }

    const rest = listed.slice(page.offset);
    const lines = rest.map((r) => `  ${r.path}`);
    const afterChars = after.reduce((sum, line) => sum + line.length + 1, 0);
    const shown = fitting(lines, page.limit, MAX_ANSWER_CHARS - REACH_HEADROOM - afterChars - body[0].length);
    if (page.offset > 0) body.push(`Showing ${formatCount(page.offset + 1)}–${formatCount(page.offset + shown)} of ${formatCount(listed.length)}.`);

    const atDistance = new Map<number, number>();
    for (const r of a.reached) atDistance.set(r.distance, (atDistance.get(r.distance) ?? 0) + 1);
    let group = 0;
    for (let i = 0; i < shown; i++){
        if (page.transitive && rest[i].distance !== group){
            group = rest[i].distance;
            body.push(`Distance ${group} (${formatCount(atDistance.get(group) ?? 0)}):`);
        }
        body.push(lines[i]);
    }

    const hidden = listed.length - page.offset - shown;
    if (hidden > 0) body.push(moreLine(hidden, page.offset + shown));
    body.push(...after);
    return { body };
}

/** How many of a list's files are shown before "… N more": a list of areas, or of files nothing imports. */
const LIST_SHOWN = 50;

function listBlock(header: string, paths: readonly string[]): string[] {
    const shown = paths.slice(0, LIST_SHOWN).map((p) => `  ${p}`);
    return [header, ...shown, ...(paths.length > LIST_SHOWN ? [`  ${moreLine(paths.length - LIST_SHOWN)}`] : [])];
}

/** The lines after a count or list of dependents (ADR-055): the tests among them, and the files nothing imports that load the target. */
export function rootLines(tests: number, roots: Roots | null): string[] {
    const lines: string[] = [];
    if (tests > 0) lines.push(`Tests among them: ${formatCount(tests)}.`);
    if (roots && roots.declared.length > 0) lines.push(...listBlock(`Entry points a package.json names that load it (${formatCount(roots.declared.length)}):`, roots.declared));
    if (roots && roots.others.length > 0) lines.push(...listBlock(`Other files nothing imports that load it (${formatCount(roots.others.length)}):`, roots.others));
    return lines;
}

/** imports with group_by (ADR-055): the counts by area in place of the list. */
export function impactAnswer(i: Impact): AnswerParts {
    const body = [reachHeader(i.reach)];
    if (i.reach.reached.length === 0) return { body };
    body.push(i.groupBy === null ? "By area:" : i.groupBy === "" ? "By area (the repo's top level):" : `By area (inside ${i.groupBy}/):`);
    for (const a of i.areas.slice(0, LIST_SHOWN)) body.push(`  ${shownPath(a.path, a.kind)}  ${formatCount(a.count)}`);
    if (i.areas.length > LIST_SHOWN) body.push(`  ${moreLine(i.areas.length - LIST_SHOWN)} areas`);
    if (i.elsewhere > 0) body.push(`  elsewhere (outside ${i.groupBy}/)  ${formatCount(i.elsewhere)}`);
    body.push(...rootLines(i.tests, i.roots));
    return { body };
}

export function chainAnswer(c: ChainAnswer): AnswerParts {
    const from = shownPath(c.from, c.fromKind);
    const to = shownPath(c.to, c.toKind);
    if (c.found === "none") return { body: [`No chain of imports joins ${from} and ${to}, in either direction.`] };

    const steps = plural(c.files.length - 1, "step");
    const body = [c.found === "forward"
        ? `${from} reaches ${to} in ${steps}:`
        : `${from} doesn't reach ${to} through imports; the other way round, ${to} reaches ${from} in ${steps}:`];
    body.push(`  ${c.files[0]}`);
    for (let i = 1; i < c.files.length; i++) body.push(`  → ${c.files[i]}  (import "${c.specifiers[i - 1]}")`);
    return { body };
}

// ---- architecture (ADR-055) ----

const NAMES_SHOWN = 20;
/** Pairs and lines shown in the layers and conventions reports before "… N more": a big repo has hundreds. */
const PAIR_LINES = 20;
const LEVEL_LINES = 30;
const SUMMARY_LEVELS = 8;
const CIRCLE_LINES = 10;
const CYCLE_STEPS = 20;
const RARE_LINES = 30;

/** Where a report is about: "src/", or "the repo". */
const whereOf = (a: ArchitectureAnswer): string => (a.path === "" ? "the repo" : shownPath(a.path, a.kind === "file" ? "file" : "folder"));

/** A part as answers write it: relative to the place, folders with a "/". */
function partName(a: ArchitectureAnswer, part: Part): string {
    const prefix = a.path === "" ? "" : `${a.path}/`;
    return shownPath(part.path.startsWith(prefix) ? part.path.slice(prefix.length) : part.path, part.kind);
}

const namesList = (names: readonly string[]): string =>
    names.length <= NAMES_SHOWN ? names.join(", ") : `${names.slice(0, NAMES_SHOWN).join(", ")}, … ${formatCount(names.length - NAMES_SHOWN)} more`;

function layerLines(a: ArchitectureAnswer, layers: Layers): string[] {
    const name = (p: Part): string => partName(a, p);
    const lines = [`Layers of ${whereOf(a)}, bottom first (each uses only the layers below it, except the imports listed after):`];
    layers.levels.slice(0, LEVEL_LINES).forEach((level, n) => lines.push(`  ${n}  ${namesList(level.map(name))}`));
    if (layers.levels.length > LEVEL_LINES) lines.push(`  ${moreLine(layers.levels.length - LEVEL_LINES)} levels`);
    if (layers.against.length === 0) lines.push("Against that order: none.");
    else {
        const total = layers.against.reduce((sum, x) => sum + x.count, 0);
        lines.push(`Against that order (${plural(total, "import")}):`);
        for (const x of layers.against.slice(0, PAIR_LINES)){
            lines.push(`  ${name(x.from)} → ${name(x.to)}  ${formatCount(x.count)}`);
            for (const [from, to] of x.examples) lines.push(`    ${from} → ${to}`);
            if (x.count > x.examples.length) lines.push("    …");
        }
        if (layers.against.length > PAIR_LINES) lines.push(`  ${moreLine(layers.against.length - PAIR_LINES)} pairs`);
    }
    for (const t of layers.tangled.slice(0, PAIR_LINES)) lines.push(`As many imports each way: ${name(t.a)} ↔ ${name(t.b)}  ${formatCount(t.count)} each`);
    if (layers.tangled.length > PAIR_LINES) lines.push(`${moreLine(layers.tangled.length - PAIR_LINES)} pairs with as many imports each way`);
    for (const circle of layers.circles.slice(0, CIRCLE_LINES)) lines.push(`Using each other in a circle: ${namesList(circle.map(name))}`);
    if (layers.circles.length > CIRCLE_LINES) lines.push(`${moreLine(layers.circles.length - CIRCLE_LINES)} circles`);
    if (layers.unlinked.length > 0) lines.push(`Not linked to the others: ${namesList(layers.unlinked.map(name))}`);
    return lines;
}

/** The names a report shows: when more than NAMES_SHOWN recur, the most-recurring (ties by name), in name order. */
function keptNames(c: Conventions): { shown: Conventions["names"]; hidden: number } {
    if (c.names.length <= NAMES_SHOWN) return { shown: c.names, hidden: 0 };
    const top = [...c.names].sort((x, y) => y.folders - x.folders || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)).slice(0, NAMES_SHOWN);
    return { shown: top.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)), hidden: c.names.length - NAMES_SHOWN };
}

function conventionLines(a: ArchitectureAnswer, c: Conventions): string[] {
    const where = whereOf(a);
    if (c.names.length === 0) return [`No folder name recurs in ${c.minFolders} or more folders under ${where}.`];
    const { shown, hidden } = keptNames(c);
    const kept = new Set(shown.map((n) => n.name));
    const lines = [
        `Folder names that recur under ${where} (in ${c.minFolders} or more folders): ${shown.map((n) => `${n.name} (${formatCount(n.folders)})`).join(", ")}${hidden > 0 ? `, … ${formatCount(hidden)} more` : ""}.`,
        "What each one's files import:",
    ];
    const pairs = c.pairs.filter((p) => kept.has(p.from) && kept.has(p.to));
    const byFrom = new Map<string, { to: string; count: number }[]>();
    for (const p of pairs) byFrom.set(p.from, [...(byFrom.get(p.from) ?? []), { to: p.to, count: p.count }]);
    for (const [from, tos] of byFrom) lines.push(`  ${from} → ${tos.map((t) => `${t.to} ${formatCount(t.count)}`).join(", ")}`);
    const rare = pairs.filter((p) => p.examples.length > 0);
    if (rare.length > 0){
        lines.push(`The rarer pairs (${RARE_PAIR} imports or fewer):`);
        for (const p of rare.slice(0, RARE_LINES)) lines.push(`  ${p.from} → ${p.to}: ${p.examples.map(([x, y]) => `${x} → ${y}`).join("; ")}`);
        if (rare.length > RARE_LINES) lines.push(`  ${moreLine(rare.length - RARE_LINES)} pairs`);
    }
    return lines;
}

function cycleLines(a: ArchitectureAnswer, page: { limit: number; offset: number }): string[] {
    if (a.through){
        const t = a.through;
        if (t.cycle === null) return [`${t.file} is in no import cycle.`];
        const lines = [`The shortest import cycle through ${t.file} (${plural(t.cycle.length - 1, "step")}):`, `  ${t.cycle[0]}`];
        const step = (i: number): string => `  → ${t.cycle![i]}  (import "${t.specifiers[i - 1]}")`;
        const last = t.cycle.length - 1;
        if (last <= 2 * CYCLE_STEPS) for (let i = 1; i <= last; i++) lines.push(step(i));
        else {
            for (let i = 1; i <= CYCLE_STEPS; i++) lines.push(step(i));
            lines.push(`  ${moreLine(last - 2 * CYCLE_STEPS)} steps`);
            for (let i = last - CYCLE_STEPS + 1; i <= last; i++) lines.push(step(i));
        }
        return lines;
    }
    const groups = a.cycles ?? [];
    const where = whereOf(a);
    if (groups.length === 0) return [`No import cycle touches ${where}.`];
    const files = groups.reduce((sum, g) => sum + g.size, 0);
    const lines = [`Import cycles touching ${where}: ${formatCount(groups.length)}, holding ${plural(files, "file")} in all.`];
    if (page.offset >= groups.length) return [...lines, `Nothing at offset ${page.offset}: there are ${formatCount(groups.length)} groups.`];
    const rest = groups.slice(page.offset).map((g) => `  ${plural(g.size, "file")}: ${namesList(g.files)}`);
    const shown = fitting(rest, page.limit, MAX_ANSWER_CHARS - REACH_HEADROOM - lines[0].length);
    lines.push(...rest.slice(0, shown));
    const hidden = rest.length - shown;
    if (hidden > 0) lines.push(moreLine(hidden, page.offset + shown));
    return lines;
}

const UNUSED_NOTE = "a file nothing imports may still be loaded by name (a build script, a worker, an HTML page, a test runner), so check before deleting it.";

function unusedLines(a: ArchitectureAnswer, u: Unused, page: { limit: number; offset: number }): { lines: string[]; notes: string[] } {
    const total = u.declared.length + u.others.length;
    const tests = u.tests > 0 ? `, not counting ${plural(u.tests, "test file")}` : "";
    const head = `Files in ${whereOf(a)} that no indexed file imports: `;
    if (total === 0) return { lines: [`${head}none${tests}.`], notes: [] };
    const lines = [`${head}${formatCount(total)}${tests}.`];
    if (u.declared.length > 0) lines.push(...listBlock(`Named as entry points by a package.json (${formatCount(u.declared.length)}):`, u.declared));
    if (u.others.length > 0){
        lines.push(`Not named anywhere (${formatCount(u.others.length)}):`);
        if (page.offset >= u.others.length) return { lines: [...lines, `Nothing at offset ${page.offset}: the list has ${formatCount(u.others.length)}.`], notes: [UNUSED_NOTE] };
        const rest = u.others.slice(page.offset);
        const shown = fitting(rest.map((p) => `  ${p}`), page.limit, MAX_ANSWER_CHARS / 2);
        lines.push(...rest.slice(0, shown).map((p) => `  ${p}`));
        if (rest.length > shown) lines.push(`  ${moreLine(rest.length - shown, page.offset + shown)}`);
    }
    return { lines, notes: [UNUSED_NOTE] };
}

function summaryLines(a: ArchitectureAnswer): string[] {
    const lines = [`${a.path === "" ? "The repo" : whereOf(a)} — what its imports say about how it's organized:`];
    const l = a.layers!;
    const order = l.levels.slice(0, SUMMARY_LEVELS).map((level) => namesList(level.map((p) => partName(a, p)))).join(" · ")
        + (l.levels.length > SUMMARY_LEVELS ? ` · ${moreLine(l.levels.length - SUMMARY_LEVELS)} levels` : "");
    const against = l.against.reduce((sum, x) => sum + x.count, 0);
    lines.push(l.levels.length === 0 ? "Layers: its parts don't import each other."
        : `Layers, bottom first: ${order}${against > 0 ? ` (${plural(against, "import")} against that order)` : ""}`);
    const c = a.conventions!;
    lines.push(c.names.length === 0 ? `Folder conventions: none (no folder name recurs in ${c.minFolders} or more folders)`
        : `Folder conventions: ${keptNames(c).shown.map((n) => n.name).join(", ")}${keptNames(c).hidden > 0 ? `, … ${formatCount(keptNames(c).hidden)} more` : ""}`);
    const groups = a.cycles ?? [];
    lines.push(groups.length === 0 ? "Import cycles: none" : `Import cycles: ${formatCount(groups.length)}, the largest ${plural(groups[0].size, "file")}`);
    const u = a.unused!;
    const total = u.declared.length + u.others.length;
    lines.push(total === 0 ? "Files nothing imports: none, not counting tests"
        : `Files nothing imports: ${formatCount(total)}, not counting tests${u.declared.length > 0 ? ` (${plural(u.declared.length, "entry point")} named by a package.json)` : ""}`);
    lines.push('For details, ask again with report "layers", "conventions", "cycles" or "unused".');
    return lines;
}

/** architecture (ADR-055): one small function per report, each returning lines. */
export function architectureAnswer(a: ArchitectureAnswer, page: { limit: number; offset: number }): AnswerParts {
    switch (a.report){
        case "summary": return { body: summaryLines(a) };
        case "layers": return { body: layerLines(a, a.layers!) };
        case "conventions": return { body: conventionLines(a, a.conventions!) };
        case "cycles": return { body: cycleLines(a, page) };
        case "unused": {
            const { lines, notes } = unusedLines(a, a.unused!, page);
            return { body: lines, notes };
        }
    }
}
