import fs from "fs";
import path from "path";
import type { SourceResponse } from "../contracts";
import { getDb } from "../db/client";
import { loadFileInfo } from "../db/store/map";
import { requireRepository } from "../db/store/structure";
import { rulesFor } from "../index/languages/rules";
import { repoKey } from "../index/paths";
import { PathNotFoundError } from "./level";

/** The most of a file the viewer gets: 1 MB is about 25,000 lines of TypeScript, far past any file people read. */
export const MAX_SOURCE_BYTES = 1_000_000;

/** Whether a resolved path is strictly inside the resolved repo root. */
export function insideRoot(resolved: string, root: string): boolean {
    const relative = path.relative(root, resolved);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * What the viewer highlights the text as: the language of the rules claiming the file (E4, ADR-065), the one stored in
 * files.language, so a language reaches the viewer exactly when the index reads it. The rules are pure: reading them
 * loads no grammar.
 */
function languageOf(filePath: string): string {
    return rulesFor(filePath)?.languageOf(filePath) ?? "text";
}

/**
 * How many of `bytes` to keep so a cut at `maxBytes` never splits a UTF-8 character: the first byte left out mustn't be
 * a continuation byte (10xxxxxx), or the character it belongs to began inside the kept part; then the cut backs off to
 * that character's first byte, leaving it out whole. Decoding half a character showed as "�" (deferred minor).
 */
export function cutAtCharacter(bytes: Uint8Array, maxBytes: number): number {
    if (bytes.length <= maxBytes) return bytes.length;
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return end;
}

/**
 * The first `count` bytes of a file, without reading the rest: a file that grew past the index's cap since it was
 * indexed would otherwise be read whole just to be cut.
 */
function readStart(filePath: string, count: number): { bytes: Buffer; size: number } {
    const fd = fs.openSync(filePath, "r");
    try{
        const size = fs.fstatSync(fd).size;
        const bytes = Buffer.alloc(Math.min(size, count));
        let read = 0;
        while (read < bytes.length){
            const n = fs.readSync(fd, bytes, read, bytes.length - read, read);
            if (n === 0) break;
            read += n;
        }
        return { bytes: bytes.subarray(0, read), size };
    } finally{
        fs.closeSync(fd);
    }
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

    const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
    let start: { bytes: Buffer; size: number };
    try{
        const root = fs.realpathSync(path.resolve(repoRoot));
        const resolved = fs.realpathSync(path.join(root, filePath));
        if (!insideRoot(resolved, root)) throw new PathNotFoundError(filePath);
        // one byte past the cut, so cutAtCharacter can see whether the cut lands inside a character
        start = readStart(resolved, maxBytes + 1);
    } catch (err){
        if (err instanceof PathNotFoundError) throw err;
        throw new PathNotFoundError(filePath);   // deleted or unreadable since it was indexed
    }

    const content = start.bytes.subarray(0, cutAtCharacter(start.bytes, maxBytes)).toString("utf8");
    return { repo, path: filePath, content, lineCount: countLines(content), truncated: start.size > maxBytes, language: languageOf(filePath) };
}
