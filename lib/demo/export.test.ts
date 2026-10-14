import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import type { DemoDescribeBundle, DemoManifest, DemoPageIndex, DemoSearchIndex, LevelResponse } from "../contracts";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { makeTempDir } from "../../test/helpers/temp";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { exportDemo, ExportRefusedError } from "./export";
import { findLeak, leakNeedles } from "./privacy";

const read = <T>(dir: string, rel: string): T => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")) as T;
const NOW = new Date("2026-10-14T00:00:00.000Z");

async function exportedFixture(): Promise<{ root: string; out: string; report: ReturnType<typeof exportDemo> }> {
    const root = copyFixture();
    indexRepository(root);
    const texts = { "src/core/log.ts": { tagline: "Console logging helpers", summary: "Defines log and the Logger class." } };
    await runSummaries(root, { summarizer: stubSummarizer({ texts }).summarizer, transport: "direct" });
    const out = path.join(makeTempDir("neb-demo-"), "demo");
    return { root, out, report: exportDemo(root, out, { publicName: "mini", now: NOW }) };
}

describe("exportDemo", () => {
    it("names the folders by id and writes one level file per folder and one describe bundle per folder", async () => {
        const { out, report } = await exportedFixture();
        const manifest = read<DemoManifest>(out, "manifest.json");
        expect(manifest).toMatchObject({ format: 1, repo: "mini", exportedAt: NOW.toISOString(), pages: {} });
        expect(manifest.folders).toEqual(["", "scripts", "src", "src/app", "src/core", "src/util"]);
        expect(manifest.status.repo).toBe("mini");
        expect(report).toMatchObject({ folders: 6, levelFiles: 6, bundles: 6, pageIndexes: 0, leaks: [] });
        expect(Object.keys(read<DemoDescribeBundle>(out, "describe/0.json"))).toEqual([""]);
        expect(Object.keys(read<DemoDescribeBundle>(out, "describe/4.json"))).toEqual(["src/core", "src/core/index.ts", "src/core/log.ts"]);
        expect(Object.keys(read<DemoDescribeBundle>(out, "describe/5.json"))).toEqual(["src/util", "src/util/strings.test.ts", "src/util/strings.ts"]);
    });

    it("writes each level with the repo's public name in place of its root", async () => {
        const { out } = await exportedFixture();
        const top = read<LevelResponse>(out, "level/0-0.json");
        expect(top.repo).toBe("mini");
        expect(top.nodes.map((n) => n.path)).toEqual(["src", "scripts"]);
        expect(top.edges).toEqual([{ source: "scripts", target: "src", count: 2 }]);
        expect(read<DemoDescribeBundle>(out, "describe/3.json")["src/app/main.ts"].repo).toBe("mini");
    });

    it("writes the search index: files with importers and test flags, declarations, folders, summaries", async () => {
        const { out } = await exportedFixture();
        const search = read<DemoSearchIndex>(out, "search.json");
        expect(search.files).toEqual([
            ["scripts/build.js", 0, 0], ["src/app/main.ts", 3, 0], ["src/app/view.tsx", 1, 0], ["src/core/index.ts", 1, 0],
            ["src/core/log.ts", 3, 0], ["src/index.ts", 1, 0], ["src/util/strings.test.ts", 0, 1], ["src/util/strings.ts", 2, 0],
        ]);
        expect(search.declarations).toEqual([["main", 1], ["render", 2], ["View", 2], ["log", 4], ["Logger", 4], ["banner", 4], ["start", 5], ["checks", 6], ["shout", 7]]);
        expect(search.folders).toEqual([["scripts", 1], ["src", 7], ["src/app", 2], ["src/core", 2], ["src/util", 2]]);
        expect(search.summaries).toHaveLength(13);
        expect(search.summaries).toContainEqual([0, "src/core/log.ts", "Console logging helpers", "Defines log and the Logger class."]);
        expect(search.summaries).toContainEqual([0, "src/util/strings.test.ts", "Tests for strings", "Test code (3 lines) for strings. Test files get this template instead of a model-written summary."]);
    });

    it("leaves no spelling of the repo's folder in any file", async () => {
        const { root, out } = await exportedFixture();
        const needles = leakNeedles({ folders: [root] });
        for (const file of fs.readdirSync(out, { recursive: true, withFileTypes: true })){
            if (file.isFile()) expect(findLeak(fs.readFileSync(path.join(file.parentPath, file.name), "utf8"), needles)).toBeNull();
        }
    });

    it("pages a big folder and indexes its pages", () => {
        const root = makeTempDir("neb-big-");
        fs.mkdirSync(path.join(root, "big"));
        for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(root, "big", `f${String(i).padStart(2, "0")}.ts`), "export const v = 0;\n");
        indexRepository(root);
        const out = path.join(makeTempDir("neb-demo-"), "demo");
        const report = exportDemo(root, out, { publicName: "big-repo", now: NOW });
        const manifest = read<DemoManifest>(out, "manifest.json");
        expect(manifest.folders).toEqual(["", "big"]);
        expect(manifest.pages).toEqual({ "1": 2 });
        const pages = read<DemoPageIndex>(out, "pages/1.json");
        expect(pages.boxes.map((b) => b.length)).toEqual([44, 16]);
        expect([pages.boxes[0][0], pages.boxes[0][43], pages.boxes[1][0], pages.boxes[1][15]]).toEqual(["big/f00.ts", "big/f43.ts", "big/f44.ts", "big/f59.ts"]);
        expect(read<LevelResponse>(out, "level/1-1.json").page).toBe(1);
        expect(Object.keys(read<DemoDescribeBundle>(out, "describe/1.json"))).toHaveLength(61);
        expect(report).toMatchObject({ levelFiles: 3, pageIndexes: 1 });
    });

    it("refuses a folder that isn't an earlier export, and leaves it alone", async () => {
        const root = copyFixture();
        indexRepository(root);
        const out = makeTempDir("neb-not-demo-");
        fs.writeFileSync(path.join(out, "keep.txt"), "mine");
        expect(() => exportDemo(root, out, { publicName: "mini" })).toThrow(ExportRefusedError);
        expect(fs.readFileSync(path.join(out, "keep.txt"), "utf8")).toBe("mine");
    });
});
