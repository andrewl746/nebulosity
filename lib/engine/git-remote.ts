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

/**
 * "git@host:owner/repo.git": scp-style, the form GitHub's "SSH" clone button gives. The user is optional, as it is to
 * git ("host:owner/repo"); a slash right after the colon means a path instead ("C:/repos/x", "https://...").
 */
const SCP_STYLE = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/;

/** Azure DevOps's ssh host, whose paths start with a "v3" that names its protocol, not the owner. */
const AZURE_SSH_HOSTS: ReadonlySet<string> = new Set(["ssh.dev.azure.com", "vs-ssh.visualstudio.com"]);

/**
 * A remote url's owner and name: "https://github.com/microsoft/vscode.git" → microsoft / vscode. The name is the last
 * path segment without ".git", and the owner is everything before it, so a nested GitLab group stays whole. Azure
 * DevOps's "_git" (https) and "v3" (ssh) are markers, not part of the owner: dev.azure.com/org/project/_git/repo is
 * org/project / repo. A local path, or a url without both, gives null.
 */
export function remoteOwnerAndName(url: string): RepoRemote | null {
    let host: string;
    let repoPath: string;
    const scp = SCP_STYLE.exec(url);
    if (scp){
        host = scp[1];
        repoPath = scp[2];
    } else {
        try{
            const parsed = new URL(url);
            if (!parsed.host) return null;   // "C:/repos/x" parses with protocol "c:" and no host; file:// has none either
            host = parsed.hostname;
            repoPath = parsed.pathname;
        } catch{
            return null;   // a relative path
        }
    }
    let segments = repoPath.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter((segment) => segment !== "" && segment !== "_git");
    if (AZURE_SSH_HOSTS.has(host) && segments[0] === "v3") segments = segments.slice(1);
    if (segments.length < 2) return null;
    return { owner: segments.slice(0, -1).join("/"), name: segments[segments.length - 1] };
}

/**
 * Where a repo's git config is. Usually `<root>/.git/config`; but a worktree or a submodule keeps a pointer file at
 * `.git` ("gitdir: <path>", relative to the repo or absolute). A submodule's git folder has its own config; a
 * worktree's has a `commondir` file naming the main git folder, whose config holds the remotes.
 */
function gitConfigPath(root: string): string | null {
    const dotGit = path.join(root, ".git");
    if (fs.statSync(dotGit).isDirectory()) return path.join(dotGit, "config");
    const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
    if (!pointer) return null;
    const gitDir = path.resolve(root, pointer[1].trim());
    const commonDir = path.join(gitDir, "commondir");
    const configDir = fs.existsSync(commonDir) ? path.resolve(gitDir, fs.readFileSync(commonDir, "utf8").trim()) : gitDir;
    return path.join(configDir, "config");
}

/**
 * A repo's origin owner and name, read from its git config (a worktree's or submodule's too: gitConfigPath). Null
 * when there's no git folder, no usable origin, or a pointer that leads nowhere; the top bar then shows the folder name.
 */
export function readRepoRemote(root: string): RepoRemote | null {
    try{
        const configPath = gitConfigPath(root);
        if (configPath === null) return null;
        const url = originUrl(fs.readFileSync(configPath, "utf8"));
        return url === null ? null : remoteOwnerAndName(url);
    } catch{
        return null;
    }
}
