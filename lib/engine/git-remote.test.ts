import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/helpers/temp";
import { originUrl, readRepoRemote, remoteOwnerAndName } from "./git-remote";

// ../vscode/.git/config at cc3fec88, as captured while planning V1.3.1
const VSCODE_CONFIG = `[core]
\trepositoryformatversion = 0
\tfilemode = false
\tbare = false
\tlogallrefupdates = true
\tsymlinks = false
\tignorecase = true
[remote "origin"]
\turl = https://github.com/microsoft/vscode.git
\tfetch = +refs/heads/main:refs/remotes/origin/main
[branch "main"]
\tremote = origin
\tmerge = refs/heads/main
[lfs]
\trepositoryformatversion = 0
`;

describe("originUrl", () => {
    it("reads the origin remote's url from a git config", () => {
        expect(originUrl(VSCODE_CONFIG)).toBe("https://github.com/microsoft/vscode.git");
    });

    it("reads origin's url, not another remote's", () => {
        const config = '[remote "upstream"]\n\turl = https://x/y/z.git\n[remote "origin"]\n\turl = git@github.com:me/fork.git\n';
        expect(originUrl(config)).toBe("git@github.com:me/fork.git");
    });

    it("finds nothing without an origin, or an origin without a url", () => {
        expect(originUrl("[core]\n\tbare = false\n")).toBeNull();
        expect(originUrl('[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n')).toBeNull();
    });
});

describe("remoteOwnerAndName", () => {
    it("reads the owner and name from https, scp-style and ssh urls", () => {
        expect(remoteOwnerAndName("https://github.com/microsoft/vscode.git")).toEqual({ owner: "microsoft", name: "vscode" });
        expect(remoteOwnerAndName("https://github.com/microsoft/vscode")).toEqual({ owner: "microsoft", name: "vscode" });
        expect(remoteOwnerAndName("git@github.com:andrewl746/Nebulosity.git")).toEqual({ owner: "andrewl746", name: "Nebulosity" });
        expect(remoteOwnerAndName("ssh://git@github.com/owner/repo.git")).toEqual({ owner: "owner", name: "repo" });
        expect(remoteOwnerAndName("https://github.com/a/b/")).toEqual({ owner: "a", name: "b" });
    });

    it("keeps a nested group as the owner", () => {
        expect(remoteOwnerAndName("https://gitlab.com/group/sub/repo.git")).toEqual({ owner: "group/sub", name: "repo" });
    });

    it("finds nothing in a local path, or a url without both an owner and a name", () => {
        expect(remoteOwnerAndName("C:/repos/mirror")).toBeNull();
        expect(remoteOwnerAndName("../other")).toBeNull();
        expect(remoteOwnerAndName("https://github.com/")).toBeNull();
        expect(remoteOwnerAndName("https://github.com/onlyowner")).toBeNull();
    });
});

describe("readRepoRemote", () => {
    it("reads a repo's origin from its .git folder", () => {
        const root = makeTempDir("neb-remote-");
        fs.mkdirSync(path.join(root, ".git"));
        fs.writeFileSync(path.join(root, ".git", "config"), VSCODE_CONFIG);
        expect(readRepoRemote(root)).toEqual({ owner: "microsoft", name: "vscode" });
    });

    it("follows a worktree's .git file to the main repo's config (deferred minor: it showed the folder name)", () => {
        // git worktree add: the worktree's .git file names <main>/.git/worktrees/wt, whose commondir ("../..") is the
        // main .git folder, where the config with origin lives
        const main = makeTempDir("neb-remote-");
        fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
        fs.writeFileSync(path.join(main, ".git", "config"), VSCODE_CONFIG);
        fs.writeFileSync(path.join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
        const worktree = makeTempDir("neb-remote-");
        fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
        expect(readRepoRemote(worktree)).toEqual({ owner: "microsoft", name: "vscode" });
    });

    it("follows a submodule's relative .git file to its own config", () => {
        // a submodule's .git file names ../.git/modules/<name>, relative to the submodule, which has its own config
        const parent = makeTempDir("neb-remote-");
        fs.mkdirSync(path.join(parent, ".git", "modules", "sub"), { recursive: true });
        fs.writeFileSync(path.join(parent, ".git", "modules", "sub", "config"), '[remote "origin"]\n\turl = git@github.com:me/sub.git\n');
        fs.mkdirSync(path.join(parent, "sub"));
        fs.writeFileSync(path.join(parent, "sub", ".git"), "gitdir: ../.git/modules/sub\n");
        expect(readRepoRemote(path.join(parent, "sub"))).toEqual({ owner: "me", name: "sub" });
    });

    it("finds nothing when .git is missing, or a file that leads nowhere", () => {
        const broken = makeTempDir("neb-remote-");
        fs.writeFileSync(path.join(broken, ".git"), "gitdir: ../nowhere/.git/worktrees/x\n");
        expect(readRepoRemote(broken)).toBeNull();
        expect(readRepoRemote(makeTempDir("neb-remote-"))).toBeNull();
    });
});

describe("remoteOwnerAndName: the shapes that fell back to the folder name (deferred minor)", () => {
    it("reads Azure DevOps urls, leaving out its _git and v3 markers", () => {
        expect(remoteOwnerAndName("https://dev.azure.com/contoso/Fabrikam/_git/Fabrikam-Fiber")).toEqual({ owner: "contoso/Fabrikam", name: "Fabrikam-Fiber" });
        expect(remoteOwnerAndName("https://contoso.visualstudio.com/Fabrikam/_git/Fiber")).toEqual({ owner: "Fabrikam", name: "Fiber" });
        expect(remoteOwnerAndName("git@ssh.dev.azure.com:v3/contoso/Fabrikam/Fabrikam-Fiber")).toEqual({ owner: "contoso/Fabrikam", name: "Fabrikam-Fiber" });
    });

    it("reads scp-style urls without a user, as git does", () => {
        expect(remoteOwnerAndName("github.com:owner/repo.git")).toEqual({ owner: "owner", name: "repo" });
        // a Windows path is still a path: its colon is followed by a slash
        expect(remoteOwnerAndName("C:/repos/mirror")).toBeNull();
    });
});
