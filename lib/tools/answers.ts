import type { AreaCount, DescribeResponse, DocPointer, SearchResult } from "../contracts";
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
        if (d.symbols.length === 0) body.push("Declarations: none.");
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

export function reachAnswer(a: ReachAnswer, page: ReachPage): AnswerParts {
    const target = shownPath(a.path, a.kind);
    const total = a.reached.length;
    if (total === 0){
        return { body: [a.direction === "dependents"
            ? (a.kind === "folder" ? `Nothing outside ${target} imports it.` : `Nothing imports ${target}.`)
            : (a.kind === "folder" ? `${target} imports nothing outside it.` : `${target} imports no other indexed file.`)] };
    }

    const body = [a.direction === "dependents"
        ? `${target} is imported${a.kind === "folder" ? " from outside it" : ""} by ${plural(a.direct, "file")} directly and ${plural(total, "file")} in all, counting files that reach it through others.`
        : `${target} imports ${plural(a.direct, "file")}${a.kind === "folder" ? " outside it" : ""} directly and ${plural(total, "file")} in all, counting what those import in turn.`];

    // reached is nearest first, so the direct files lead it
    const listed = page.transitive ? a.reached : a.reached.slice(0, a.direct);
    if (page.offset >= listed.length){
        body.push(`Nothing at offset ${page.offset}: the list has ${formatCount(listed.length)}.`);
        return { body };
    }

    const rest = listed.slice(page.offset);
    const lines = rest.map((r) => `  ${r.path}`);
    const shown = fitting(lines, page.limit, MAX_ANSWER_CHARS - REACH_HEADROOM - body[0].length);
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
