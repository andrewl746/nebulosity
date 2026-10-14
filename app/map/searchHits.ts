import type { SearchHit } from "@/lib/contracts";
import { FILE_CHUNK } from "@/lib/engine/rank";

/** How the palette names a hit's best code: the declaration and its lines, or an imports listing (ADR-052). */
export function codeLabel(code: NonNullable<SearchHit["code"]>): string {
    if (code.symbol === FILE_CHUNK) return "imports and exports";
    return `${code.symbol} · ${code.startLine === code.endLine ? `line ${code.startLine}` : `lines ${code.startLine}–${code.endLine}`}`;
}

/**
 * The search palette's two groups (owner review, 2026-10-13): every folder hit first, then every file hit, each in the
 * order the server ranked them. `ordered` is the list the arrow keys walk. Searching "terminal" should show the
 * terminal folders up top, not somewhere among dozens of files about terminals.
 */
export function groupHits(hits: readonly SearchHit[]): { folders: SearchHit[]; files: SearchHit[]; ordered: SearchHit[] } {
    const folders = hits.filter((h) => h.kind === "folder");
    const files = hits.filter((h) => h.kind === "file");
    return { folders, files, ordered: [...folders, ...files] };
}
