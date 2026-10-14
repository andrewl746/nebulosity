import type { DemoManifest, DemoPageIndex } from "@/lib/contracts";
import { parentOf } from "./paths";

/**
 * Pure lookups over the static demo's manifest (API_CONTRACTS.md §18): folders are named by id in the file paths, so a
 * folder called "my docs #1" never has to survive a URL.
 */
export type DemoIndex = { manifest: DemoManifest; ids: Map<string, number> };

export const indexManifest = (manifest: DemoManifest): DemoIndex => ({ manifest, ids: new Map(manifest.folders.map((p, i) => [p, i])) });
export const levelFile = (id: number, page: number): string => `level/${id}-${page}.json`;
export const describeFile = (id: number): string => `describe/${id}.json`;
export const pagesFile = (id: number): string => `pages/${id}.json`;
export const pageCountOf = (index: DemoIndex, id: number): number => index.manifest.pages[String(id)] ?? 1;
/** A page past the last is the last, as the server answers (API_CONTRACTS.md §11). */
export const clampPage = (page: number, pageCount: number): number => Math.min(Math.max(0, Math.floor(page)), pageCount - 1);

/** The child of `folder` on the way to `target` (the target itself when it's directly inside), or null when it isn't inside. */
export function boxToward(folder: string, target: string): string | null {
    const prefix = folder === "" ? "" : `${folder}/`;
    if (target === folder || !target.startsWith(prefix)) return null;
    const rest = target.slice(prefix.length);
    const slash = rest.indexOf("/");
    return prefix + (slash === -1 ? rest : rest.slice(0, slash));
}

export function pageHolding(pages: DemoPageIndex, box: string): number | null {
    const at = pages.boxes.findIndex((boxes) => boxes.includes(box));
    return at === -1 ? null : at;
}

/** The bundle holding a path's describe answer: a folder's own, or its folder's for a file; null when neither is indexed. */
export function bundleIdFor(index: DemoIndex, targetPath: string): number | null {
    return index.ids.get(targetPath) ?? index.ids.get(parentOf(targetPath)) ?? null;
}
