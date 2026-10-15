import path from "path";
import type { RepoList } from "../contracts";
import { readConfig, writeConfig } from "../config";
import { getDb } from "../db/client";
import { listStagedRepositories } from "../db/store/stages";
import { commandHint } from "../hints";
import { readRepoRemote } from "./git-remote";

/** Thrown when the picker names a repo that was never indexed. */
export class UnknownRepoError extends Error {
    constructor(root: string){
        super(`${root} isn't an indexed repository. Run ${commandHint("index", `"${root}"`)} first.`);
        this.name = "UnknownRepoError";
    }
}

/**
 * The repos the Map can show, and which one is active (PIVOT_SPEC.md §7.1: a picker when more than one is indexed).
 * Each carries its origin's owner and name when it has one, for the top bar (VISUAL_REFRESH.md §6).
 */
export function listRepos(): RepoList {
    const repos = listStagedRepositories(getDb()).map((r) => {
        const remote = readRepoRemote(r.rootPath);
        return {
            root: r.rootPath,
            name: path.basename(r.rootPath),
            indexedAt: r.lastIndexAt?.toISOString() ?? null,
            ...(remote ? { remote } : {}),
        };
    });
    return { active: readConfig().activeRepo, repos };
}

/** Makes an indexed repo the active one (`activeRepo` in .nebulosity/config.json) and returns the new list. */
export function setActiveRepo(root: string): RepoList {
    if (!listRepos().repos.some((r) => r.root === root)) throw new UnknownRepoError(root);
    writeConfig({ ...readConfig(), activeRepo: root });
    return listRepos();
}
