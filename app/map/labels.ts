import type { DescribeResponse, MapNode } from "@/lib/contracts";
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

/** A line's hover label: "editor uses base, 12 imports" (the arrow runs from the user to the used). */
export function lineLabel(source: MapNode, target: MapNode, count: number): string {
    const imports = `${formatCount(count)} import${count === 1 ? "" : "s"}`;
    const verb = source.kind === "portal" ? "use" : "uses";
    const who = source.kind === "portal" ? capitalized(subject(source)) : subject(source);
    return `${who} ${verb} ${subject(target)}, ${imports}`;
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
