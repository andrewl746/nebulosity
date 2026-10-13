import path from "path";
import { readConfig } from "../config";
import { getDb } from "../db/client";
import { listStagedRepositories } from "../db/store/stages";
import { NoActiveRepoError } from "../engine/errors";
import { readIndexStatus } from "../engine/status";
import { normalizeSlashes } from "../index/paths";
import type { ToolContext } from "./context";

/** One spelling for comparing folders: forward slashes, no trailing slash, and on Windows any case (C:\ is c:/). */
export function sameFolderKey(p: string, platform: NodeJS.Platform = process.platform): string {
    const slashed = normalizeSlashes(p).replace(/\/+$/, "");
    return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** How a call's repo was picked (ADR-046). */
export type RepoChoice = { root: string; how: "project" | "map" };

/**
 * Which indexed repo a call answers about (ADR-046): the one holding the project folder (the deepest, when indexed repos
 * nest), else the Map's active repo, else none. Pure: the caller passes what it read.
 */
export function chooseRepo(projectDir: string, indexedRoots: readonly string[], activeRoot: string | null, platform: NodeJS.Platform = process.platform): RepoChoice | null {
    const key = (p: string): string => sameFolderKey(p, platform);
    const here = key(projectDir);
    const holding = indexedRoots
        .filter((root) => here === key(root) || here.startsWith(`${key(root)}/`))
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
            ? `The last index update failed${structure.note ? ` (${structure.note})` : ""}, so answers may be out of date. Running npm run index in the Nebulosity folder redoes it.`
            : undefined;

    return {
        context: {
            repoRoot: choice.root,
            summariesOff: status?.stages.summaries.state === "off",
            ...(choice.how === "map" ? { repoNote: `Answering about ${name} (${choice.root}), the repo the Map shows: the project folder ${normalizeSlashes(projectDir)} isn't inside an indexed repo.` } : {}),
            ...(indexNote ? { indexNote } : {}),
        },
        live: {
            allowed: config.activeRepo !== null && sameFolderKey(config.activeRepo) === sameFolderKey(choice.root),
            port: config.port,
            mapRepo: config.activeRepo === null ? null : path.basename(config.activeRepo),
        },
    };
}
