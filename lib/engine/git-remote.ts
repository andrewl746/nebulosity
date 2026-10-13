import fs from "fs";
import path from "path";
import type { RepoRemote } from "../contracts";

/**
 * The origin remote's url in a git config file's text, or null. Only `[remote "origin"]` counts: it's the remote a
 * clone came from, which is what "owner / repo" in the top bar means (VISUAL_REFRESH.md §6).
 */
export function originUrl(gitConfig: string): string | null {
    let inOrigin = false;
    for (const raw of gitConfig.split(/\r?\n/)){
        const line = raw.trim();
        if (line.startsWith("[")){
            inOrigin = /^\[remote\s+"origin"\]$/i.test(line);
            continue;
        }
        if (!inOrigin) continue;
        const match = /^url\s*=\s*(.+)$/i.exec(line);
        if (match) return match[1].trim().replace(/^"(.*)"$/, "$1");
    }
    return null;
}

/** "git@host:owner/repo.git": scp-style, the form GitHub's "SSH" clone button gives. */
const SCP_STYLE = /^[\w.-]+@[\w.-]+:(?!\/)(.+)$/;

/**
 * A remote url's owner and name: "https://github.com/microsoft/vscode.git" → microsoft / vscode. The name is the last
 * path segment without ".git", and the owner is everything before it, so a nested GitLab group stays whole. A local
 * path, or a url without both, gives null.
 */
export function remoteOwnerAndName(url: string): RepoRemote | null {
    let repoPath: string;
    const scp = SCP_STYLE.exec(url);
    if (scp){
        repoPath = scp[1];
    } else {
        try{
            const parsed = new URL(url);
            if (!parsed.host) return null;   // "C:/repos/x" parses with protocol "c:" and no host; file:// has none either
            repoPath = parsed.pathname;
        } catch{
            return null;   // a relative path
        }
    }
    const segments = repoPath.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return { owner: segments.slice(0, -1).join("/"), name: segments[segments.length - 1] };
}

/**
 * A repo's origin owner and name, read from `<root>/.git/config`. Null when `.git` isn't a folder (a worktree or a
 * submodule keeps a pointer file there; the top bar falls back to the folder name), or there's no usable origin.
 */
export function readRepoRemote(root: string): RepoRemote | null {
    const gitDir = path.join(root, ".git");
    try{
        if (!fs.statSync(gitDir).isDirectory()) return null;
        const url = originUrl(fs.readFileSync(path.join(gitDir, "config"), "utf8"));
        return url === null ? null : remoteOwnerAndName(url);
    } catch{
        return null;
    }
}
