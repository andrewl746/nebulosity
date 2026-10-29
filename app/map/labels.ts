import type { DescribeResponse, MapEdge, MapNode } from "@/lib/contracts";
import { edgeKey } from "./emphasis";
import { formatCount } from "./format";

/**
 * Words for what the Map draws. The owner's three-task test (2026-10-13) found a newcomer reading an arrow backwards
 * ("base depends on editor"), so a line says what it means in a sentence when it's hovered.
 */

/** What a box is called inside a sentence: its name, or for a portal the boxes behind it. */
function subject(box: MapNode): string {
    if (box.kind !== "portal") return box.name;
    return box.pages ? `boxes on ${box.pages.length} other pages` : `boxes on ${box.name}`;
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A line's sentence in its parts, so the hover card can cut a long name short and keep the rest whole. */
export type LineParts = { who: string; verb: string; whom: string; imports: string };

/** lineLabel's parts: "editor", "uses", "base" and "12 imports". */
export function lineParts(source: MapNode, target: MapNode, count: number): LineParts {
    return {
        who: source.kind === "portal" ? capitalized(subject(source)) : subject(source),
        verb: source.kind === "portal" ? "use" : "uses",
        whom: subject(target),
        imports: `${formatCount(count)} import${count === 1 ? "" : "s"}`,
    };
}

/** A line's hover label: "editor uses base, 12 imports" (the arrow runs from the user to the used). */
export function lineLabel(source: MapNode, target: MapNode, count: number): string {
    const { who, verb, whom, imports } = lineParts(source, target, count);
    return `${who} ${verb} ${whom}, ${imports}`;
}

/** One line in a run's list: the box at its far end (or both ends, where the run shares neither) and its imports. */
export type RunRow = { id: string; name: string; count: number };

/**
 * What the hover card says about the lines under the pointer (the owner, 2026-10-29: on merged lines one line's
 * sentence didn't say which line it meant). One line: its sentence. Lines into one box: "Into src", then each by the
 * box it comes from; out of one box: "From build", then each by the box it goes to. Lines that share neither end (no
 * route merges them, but a list never guesses): "Lines here", each as "build → src". The heaviest first, then by name.
 */
export type RunWords =
    | { kind: "one"; id: string; parts: LineParts; sentence: string }
    | { kind: "run"; title: string; rows: RunRow[] };

export function runWords(lines: readonly MapEdge[], byPath: ReadonlyMap<string, MapNode>): RunWords {
    // every line on a level has both its boxes there
    const box = (path: string): MapNode => byPath.get(path)!;
    if (lines.length === 1){
        const [line] = lines;
        return { kind: "one", id: edgeKey(line), parts: lineParts(box(line.source), box(line.target), line.count), sentence: lineLabel(box(line.source), box(line.target), line.count) };
    }
    // a row starts with its name, so a doorway's "boxes on Page 2" takes a capital
    const name = (path: string): string => box(path).kind === "portal" ? capitalized(subject(box(path))) : box(path).name;
    const into = lines.every((l) => l.target === lines[0].target);
    const from = !into && lines.every((l) => l.source === lines[0].source);
    const title = into ? `Into ${subject(box(lines[0].target))}` : from ? `From ${subject(box(lines[0].source))}` : "Lines here";
    const rows = lines.map((l) => ({
        id: edgeKey(l),
        name: into ? name(l.source) : from ? name(l.target) : `${subject(box(l.source))} → ${subject(box(l.target))}`,
        count: l.count,
    }));
    rows.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1));
    return { kind: "run", title, rows };
}

/** A box's hover title: its path, and its one-line summary when there is one. */
export function boxTitle(box: Pick<MapNode, "path" | "name" | "tagline">): string {
    const where = box.path || box.name;
    return box.tagline ? `${where}: ${box.tagline}` : where;
}

/** The detail panel's words for a file with no declarations: a file over the size cap had them left unread (ADR-053). */
export function noDeclarationsText(file: Pick<DescribeResponse, "importsOnly">): string {
    return file.importsOnly ? "Not read, since it's over the 1 MB size cap. Only its imports were." : "None found.";
}

/**
 * The toolbar's one-line finding about a level (the Workbench redesign, ADR-070): its heaviest line, by the two boxes'
 * names, with how many of the level's imports it carries, "Heaviest link is extensions → src, 665 of 708 imports".
 * Null for a level with no lines. Ties go to the first by source, then target, so a level always says the same.
 */
export function heaviestLink(level: { nodes: readonly MapNode[]; edges: readonly { source: string; target: string; count: number }[] }): { from: string; to: string; count: number; total: number } | null {
    const lines = level.edges.filter((e) => e.source !== e.target);
    if (lines.length === 0) return null;
    const heaviest = [...lines].sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))[0];
    const name = (path: string): string => level.nodes.find((n) => n.path === path)?.name ?? path;
    return { from: name(heaviest.source), to: name(heaviest.target), count: heaviest.count, total: lines.reduce((sum, e) => sum + e.count, 0) };
}
