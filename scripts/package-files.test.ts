import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

// What `npm pack` would put in the package, from package.json's `files`, without running prepack (which wants a build).
// The 1.1.0 prep found four `*.test.tsx` files in the tarball, since `files` left out only `*.test.ts`.
function packedFiles(): string[] {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const packed = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", shell: process.platform === "win32" });
    if (packed.status !== 0) throw new Error(`npm pack --dry-run failed: ${packed.stderr}`);
    const [result] = JSON.parse(packed.stdout) as { files: { path: string }[] }[];
    return result.files.map((file) => file.path.replace(/\\/g, "/"));
}

describe("the package's files", () => {
    it("ship no test files, whatever their extension", () => {
        const tests = packedFiles().filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file));
        expect(tests).toEqual([]);
    }, 60_000);
});
