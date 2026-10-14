import { describe, expect, it } from "vitest";
import { ApiError } from "./apiError";
import { createStaticApi } from "./staticApi";

const MANIFEST = {
    format: 1, repo: "demo", remote: { owner: "acme", name: "demo" }, commit: "abc123", exportedAt: "2026-10-14T00:00:00.000Z",
    status: { repo: "demo", indexVersion: 7, stages: {} }, folders: ["", "big", "my docs #1"], pages: { "1": 2 },
};
const FILES: Record<string, unknown> = {
    "manifest.json": MANIFEST,
    "level/0-0.json": { path: "", page: 0 },
    "level/1-0.json": { path: "big", page: 0 },
    "level/1-1.json": { path: "big", page: 1 },
    "level/2-0.json": { path: "my docs #1", page: 0 },
    "pages/1.json": { boxes: [["big/a.ts", "big/sub"], ["big/z.ts"]] },
    "describe/0.json": { "": { path: "" }, "readme.ts": { path: "readme.ts" } },
    "describe/1.json": { big: { path: "big" }, "big/a.ts": { path: "big/a.ts" } },
    "describe/2.json": { "my docs #1": { path: "my docs #1" } },
    "search.json": { summaries: [[0, "big/a.ts", "Alpha helpers", "Does alpha things."]], folders: [["big", 2]], files: [["big/a.ts", 1, 0]], declarations: [] },
};

function fake(files = FILES): { fetcher: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        const key = url.slice("/demo/".length);
        return key in files ? new Response(JSON.stringify(files[key]), { status: 200 }) : new Response("missing", { status: 404 });
    }) as typeof fetch;
    return { fetcher, calls };
}

describe("the static transport", () => {
    it("reads a level page, clamping a page past the last", async () => {
        const api = createStaticApi("/demo/", fake().fetcher);
        expect(await api.level("")).toEqual({ path: "", page: 0 });
        expect(await api.level("big", 5)).toEqual({ path: "big", page: 1 });
        expect(await api.level("my docs #1")).toEqual({ path: "my docs #1", page: 0 });
    });

    it("opens the page holding a focus, through the page index", async () => {
        const api = createStaticApi("/demo/", fake().fetcher);
        expect(await api.level("big", 0, undefined, "big/z.ts")).toEqual({ path: "big", page: 1 });
        expect(await api.level("big", 1, undefined, "big/sub/deep.ts")).toEqual({ path: "big", page: 0 });
        expect(await api.level("big", 1, undefined, "elsewhere/x.ts")).toEqual({ path: "big", page: 1 });
    });

    it("answers describe from bundles, fetching each bundle once", async () => {
        const { fetcher, calls } = fake();
        const api = createStaticApi("/demo/", fetcher);
        expect(await api.describe("readme.ts")).toEqual({ path: "readme.ts" });
        expect(await api.describe("")).toEqual({ path: "" });
        expect(await api.describe("big/a.ts")).toEqual({ path: "big/a.ts" });
        expect(calls.filter((c) => c === "/demo/describe/0.json")).toHaveLength(1);
    });

    it("says nothing is indexed at an unknown path, in the server's words", async () => {
        const api = createStaticApi("/demo/", fake().fetcher);
        await expect(api.level("nope")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: 'Nothing is indexed at "nope".' });
        await expect(api.describe("big/missing.ts")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: 'Nothing is indexed at "big/missing.ts".' });
    });

    it("serves the status, a one-repo list, search, and the GitHub source; refuses what needs a server", async () => {
        const api = createStaticApi("/demo/", fake().fetcher);
        expect(await api.status()).toEqual(MANIFEST.status);
        expect(await api.repos()).toEqual({ active: "demo", repos: [{ root: "demo", name: "demo", indexedAt: null, remote: { owner: "acme", name: "demo" } }] });
        expect((await api.search("alpha", 10)).hits[0].path).toBe("big/a.ts");
        expect(await api.github()).toEqual({ owner: "acme", name: "demo", commit: "abc123" });
        await expect(api.summarize("big")).rejects.toBeInstanceOf(ApiError);
        await expect(api.reindex(() => {})).rejects.toBeInstanceOf(ApiError);
    });

    it("refuses data of another format", async () => {
        const api = createStaticApi("/demo/", fake({ ...FILES, "manifest.json": { ...MANIFEST, format: 2 } }).fetcher);
        await expect(api.status()).rejects.toMatchObject({ code: "INTERNAL" });
    });
});
