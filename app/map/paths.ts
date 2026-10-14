import type { LevelResponse } from "@/lib/contracts";

// The UI imports from lib/ only types and the few pure, browser-safe modules ARCHITECTURE.md §3 names, and
// lib/index/paths.ts isn't one of them, so these few lines mirror it.

/** The folder that holds a path ("" for something at the root). */
export function parentOf(targetPath: string): string {
    const slash = targetPath.lastIndexOf("/");
    return slash === -1 ? "" : targetPath.slice(0, slash);
}

/** What a path is called on screen: its last segment, or the repo's folder name for the root. */
export function nameOf(targetPath: string, repoRoot: string): string {
    if (targetPath === "") return repoRoot.slice(repoRoot.lastIndexOf("/") + 1) || repoRoot;
    return targetPath.slice(targetPath.lastIndexOf("/") + 1);
}

/** A path's last two segments, "src/vs/platform/files/common" → "files/common": enough to tell areas apart in a chip. */
export function shortPath(targetPath: string): string {
    return targetPath.split("/").slice(-2).join("/");
}

/** The language a path's extension implies, the way GET /api/source names it (the UI can't import lib's copy). */
export function languageFor(filePath: string): string {
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) return "typescript";
    if (/\.(js|jsx|mjs|cjs)$/.test(filePath)) return "javascript";
    return "text";
}

/** Whether `targetPath` is strictly inside `folder` ("" holds everything but itself). */
export function isInside(targetPath: string, folder: string): boolean {
    return folder === "" ? targetPath !== "" : targetPath.startsWith(`${folder}/`);
}

/**
 * The box on this level that holds `targetPath`: the child on the way down to it, or, when that child is on another
 * page, the portal standing for that page. Null when the path isn't inside this level, is the level itself, or is on a
 * page this one has no portal to. Live pulses and highlights use it.
 */
export function boxFor(level: Pick<LevelResponse, "path" | "nodes">, targetPath: string): string | null {
    if (!isInside(targetPath, level.path)) return null;
    const below = level.path === "" ? targetPath : targetPath.slice(level.path.length + 1);
    const slash = below.indexOf("/");
    const child = slash === -1 ? targetPath : `${level.path === "" ? "" : `${level.path}/`}${below.slice(0, slash)}`;
    if (level.nodes.some((n) => n.path === child)) return child;
    return level.nodes.find((n) => n.kind === "portal" && n.members?.includes(child))?.path ?? null;
}
