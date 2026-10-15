import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test/helpers/temp";
import { usesUserDataDir } from "./boot.mjs";

describe("usesUserDataDir (both launchers' one rule, ADR-044 amended)", () => {
    it("is true only with no NEBULOSITY_DATA and no .git in the package's own folder", () => {
        const installed = makeTempDir("neb-package-");
        expect(usesUserDataDir(installed, {})).toBe(true);
        expect(usesUserDataDir(installed, { NEBULOSITY_DATA: "/somewhere/data" })).toBe(false);

        const checkout = makeTempDir("neb-checkout-");
        fs.mkdirSync(path.join(checkout, ".git"));
        expect(usesUserDataDir(checkout, {})).toBe(false);

        // a git worktree (the sandbox build folder) has a .git file, not a folder
        const worktree = makeTempDir("neb-worktree-");
        fs.writeFileSync(path.join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/build\n");
        expect(usesUserDataDir(worktree, {})).toBe(false);
    });
});

describe("boot (bin/nebulosity.mjs and mcp/launch.mjs both start with it)", () => {
    it("for an installed copy points the code root at the package and the data at the user's data folder", () => {
        const installed = makeTempDir("neb-package-");
        const user = makeTempDir("neb-user-");
        // the child's user folders are this test's: LOCALAPPDATA on Windows, HOME on macOS, XDG_DATA_HOME on Linux
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)){
            if (value !== undefined && !key.startsWith("VITEST") && !key.startsWith("NEBULOSITY_")) env[key] = value;
        }
        Object.assign(env, { LOCALAPPDATA: path.join(user, "local"), XDG_DATA_HOME: path.join(user, "xdg"), HOME: user, USERPROFILE: user });

        const boot = pathToFileURL(path.resolve("bin", "boot.mjs")).href;
        const script = `import { boot } from ${JSON.stringify(boot)};`
            + ` await boot(${JSON.stringify(installed)});`
            + " console.log(JSON.stringify({ home: process.env.NEBULOSITY_HOME, data: process.env.NEBULOSITY_DATA }));";
        // Next's types make NODE_ENV a required key of ProcessEnv: the cast only satisfies them (the copy carries it if set)
        const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: env as NodeJS.ProcessEnv, encoding: "utf8" });

        const data = process.platform === "win32" ? path.join(user, "local", "Nebulosity")
            : process.platform === "darwin" ? path.join(user, "Library", "Application Support", "Nebulosity")
                : path.join(user, "xdg", "nebulosity");
        expect(JSON.parse(out)).toEqual({ home: installed, data });
    }, 30_000);
});
