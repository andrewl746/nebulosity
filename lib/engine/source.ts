import fs from "fs";
import path from "path";
import type { SourceResponse } from "../contracts";
import { getDb } from "../db/client";
import { loadFileInfo } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { repoKey } from "../index/paths";
import { PathNotFoundError } from "./level";

/** The most of a file the viewer gets: 1 MB is about 25,000 lines of TypeScript, far past any file people read. */
export const MAX_SOURCE_BYTES = 1_000_000;

/** Whether a resolved path is strictly inside the resolved repo root. */
export function insideRoot(resolved: string, root: string): boolean {
    const relative = path.relative(root, resolved);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** What the viewer highlights the text as. */
function languageOf(filePath: string): string {
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) return "typescript";
    if (/\.(js|jsx|mjs|cjs)$/.test(filePath)) return "javascript";
    return "text";
}

/** Lines in a text, the way an editor counts them: a final line break doesn't start another line. */
function countLines(text: string): number {
    if (text === "") return 0;
    return text.split(/\r?\n/).length - (/\r?\n$/.test(text) ? 1 : 0);
}

/**
 * GET /api/source (API_CONTRACTS.md §16): an indexed file's text, for the Map's source viewer (owner review). Only
 * files the index knows can be shown, so the route can't be used to read anything else in the repo (a `.env`, a
 * key), and a file that resolves outside the repo (a symlink) is refused too. Past `maxBytes` the text is cut, and
 * `truncated` says so.
 */
export function readSource(repoRoot: string, filePath: string, options: { maxBytes?: number } = {}): SourceResponse {
    const db = getDb();
    const repo = repoKey(path.resolve(repoRoot));
    const repoId = requireRepository(db, repo);
    if (!loadFileInfo(db, repoId, filePath)) throw new PathNotFoundError(filePath);

    let bytes: Buffer;
    try{
        const root = fs.realpathSync(path.resolve(repoRoot));
        const resolved = fs.realpathSync(path.join(root, filePath));
        if (!insideRoot(resolved, root)) throw new PathNotFoundError(filePath);
        bytes = fs.readFileSync(resolved);
    } catch (err){
        if (err instanceof PathNotFoundError) throw err;
        throw new PathNotFoundError(filePath);   // deleted or unreadable since it was indexed
    }

    const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
    const content = bytes.subarray(0, maxBytes).toString("utf8");
    return { repo, path: filePath, content, lineCount: countLines(content), truncated: bytes.length > maxBytes, language: languageOf(filePath) };
}
