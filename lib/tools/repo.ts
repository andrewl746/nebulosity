import path from "path";
import { readConfig } from "../config";
import { getDb } from "../db/client";
import { listStagedRepositories } from "../db/store/stages";
import { NoActiveRepoError } from "../engine/errors";
import { readIndexStatus } from "../engine/status";
import { commandHint } from "../hints";
import { normalizeSlashes, parseRepoPath } from "../index/paths";
import type { ToolContext } from "./context";

/** One spelling for comparing folders: forward slashes, no trailing slash, and on Windows any case (C:\ is c:/). */
export function sameFolderKey(p: string, platform: NodeJS.Platform = process.platform): string {
    const slashed = normalizeSlashes(p).replace(/\/+$/, "");
    return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/**
 * The part of `p` inside `root`, spelled as `p` spells it ("" for the root itself), or null when `p` isn't inside it.
 * Windows ignores case. A sibling that only shares the prefix ("vscode-docs" beside "vscode") isn't inside.
 */
export function insideRoot(p: string, root: string, platform: NodeJS.Platform = process.platform): string | null {
    const given = normalizeSlashes(p).replace(/\/+$/, "");
    const base = normalizeSlashes(root).replace(/\/+$/, "");
    const head = given.slice(0, base.length);
    const rest = given.slice(base.length);
    const same = platform === "win32" ? head.toLowerCase() === base.toLowerCase() : head === base;
    return same && (rest === "" || rest.startsWith("/")) ? rest.replace(/^\/+/, "") : null;
}

/**
 * A path from the model in the spelling stored paths use (ADR-046, amended): repo-relative as parseRepoPath takes it, or
 * absolute inside the repo, which is how Claude Code's own tools write paths. Null when it could leave the repo.
 */
export function repoPathFrom(raw: string, repoRoot: string, platform: NodeJS.Platform = process.platform): string | null {
    const given = normalizeSlashes(raw.trim());
    if (!given.startsWith("/") && !/^[a-zA-Z]:/.test(given)) return parseRepoPath(given);
    const inside = insideRoot(given, repoRoot, platform);
    return inside === null ? null : parseRepoPath(inside);
}

/** How a call's repo was picked (ADR-046). */
export type RepoChoice = { root: string; how: "project" | "map" };

/**
 * Which indexed repo a call answers about (ADR-046): the one holding the project folder (the deepest, when indexed repos
 * nest), else the Map's active repo, else none. Pure: the caller passes what it read.
 */
export function chooseRepo(projectDir: string, indexedRoots: readonly string[], activeRoot: string | null, platform: NodeJS.Platform = process.platform): RepoChoice | null {
    const key = (p: string): string => sameFolderKey(p, platform);
    const holding = indexedRoots
        .filter((root) => insideRoot(projectDir, root, platform) !== null)
        .sort((a, b) => key(b).length - key(a).length)[0];
    if (holding !== undefined) return { root: holding, how: "project" };

    const active = activeRoot === null ? undefined : indexedRoots.find((root) => key(root) === key(activeRoot));
    return active === undefined ? null : { root: active, how: "map" };
}

/** Everything one tool call needs, read fresh: a new index or a repo switch takes effect without a restart. */
export type CallSetup = {
    context: ToolContext;
    /** Whether live events may go out (only for the repo the Map shows), where to, and the Map's repo's name. */
    live: { allowed: boolean; port: number; mapRepo: string | null };
};

export function setupCall(projectDir: string): CallSetup {
    const config = readConfig();
    const roots = listStagedRepositories(getDb()).map((r) => r.rootPath);
    const choice = chooseRepo(projectDir, roots, config.activeRepo);
    if (choice === null) throw new NoActiveRepoError();

    const status = readIndexStatus(choice.root);
    const structure = status?.stages.structure;
    const name = path.basename(choice.root);
    const indexNote = structure?.state === "running"
        ? `The index is being updated (${structure.done}/${structure.total} files), so answers may miss the newest changes.`
        : structure?.state === "failed"
            ? `The last index update failed${structure.note ? ` (${structure.note})` : ""}, so answers may be out of date. Running ${commandHint("index", `"${choice.root}"`)} redoes it.`
            : undefined;
    // a session below the repo's root (a package of a monorepo) would otherwise read every path as its own folder's
    const subfolder = choice.how === "project" ? insideRoot(projectDir, choice.root) : null;
    const repoNote = choice.how === "map"
        ? `Answering about ${name} (${choice.root}), the repo the Map shows: the project folder ${normalizeSlashes(projectDir)} isn't inside an indexed repo.`
        : subfolder
            ? `Paths count from the repo root (${choice.root}), not from this session's folder: its files start with ${subfolder}/.`
            : undefined;

    return {
        context: {
            repoRoot: choice.root,
            summariesOff: status?.stages.summaries.state === "off",
            ...(repoNote ? { repoNote } : {}),
            ...(indexNote ? { indexNote } : {}),
        },
        live: {
            allowed: config.activeRepo !== null && sameFolderKey(config.activeRepo) === sameFolderKey(choice.root),
            port: config.port,
            mapRepo: config.activeRepo === null ? null : path.basename(config.activeRepo),
        },
    };
}
