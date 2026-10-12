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

    it("finds nothing when .git is a file (a worktree or submodule) or missing", () => {
        const worktree = makeTempDir("neb-remote-");
        fs.writeFileSync(path.join(worktree, ".git"), "gitdir: ../main/.git/worktrees/x\n");
        expect(readRepoRemote(worktree)).toBeNull();
        expect(readRepoRemote(makeTempDir("neb-remote-"))).toBeNull();
    });
});
