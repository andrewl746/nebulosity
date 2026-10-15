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

/** A line's hover label: "editor uses base · 12 imports" (the arrow runs from the user to the used). */
export function lineLabel(source: MapNode, target: MapNode, count: number): string {
    const imports = `${formatCount(count)} import${count === 1 ? "" : "s"}`;
    const verb = source.kind === "portal" ? "use" : "uses";
    const who = source.kind === "portal" ? capitalized(subject(source)) : subject(source);
    return `${who} ${verb} ${subject(target)} · ${imports}`;
}

/** A box's hover title: its path, and its one-line summary when there is one. */
export function boxTitle(box: Pick<MapNode, "path" | "name" | "tagline">): string {
    const where = box.path || box.name;
    return box.tagline ? `${where}: ${box.tagline}` : where;
}

/** The detail panel's words for a file with no declarations: a file over the size cap had them left unread (ADR-053). */
export function noDeclarationsText(file: Pick<DescribeResponse, "importsOnly">): string {
    return file.importsOnly ? "Not read (over the 1 MB size cap; imports only)." : "None found.";
}
