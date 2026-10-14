import { describe, expect, it, vi } from "vitest";
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

type Override = (url: string, nth: number) => Response | Promise<Response> | Error | undefined;

/**
 * A fetcher that lets `override` answer first (`nth` counts that url's calls from 1; an Error is thrown, as a dropped
 * connection is), and otherwise answers like fake().
 */
function overriding(override: Override, files = FILES): { fetcher: typeof fetch; hits: (rel: string) => number } {
    const inner = fake(files);
    const seen = new Map<string, number>();
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const nth = (seen.get(url) ?? 0) + 1;
        seen.set(url, nth);
        const answer = override(url, nth);
        if (answer instanceof Error) throw answer;
        return answer ?? inner.fetcher(input, init);
    }) as typeof fetch;
    return { fetcher, hits: (rel) => seen.get(`/demo/${rel}`) ?? 0 };
}

describe("an answer that isn't JSON", () => {
    it("is reported, not left to hang the Map: an HTML page for a missing file, a cut-off body", async () => {
        const page = overriding((url) => (url.endsWith("level/0-0.json") ? new Response("<!doctype html><title>Not found</title>", { status: 200 }) : undefined));
        const err = await createStaticApi("/demo/", page.fetcher).level("").catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err).toMatchObject({ status: 500, code: "INTERNAL", message: "The demo's level/0-0.json didn't load (it isn't JSON). Reload the page." });

        const cut = overriding((url) => (url.endsWith("describe/0.json") ? new Response('{"readme.ts": {"path": "readme', { status: 200 }) : undefined));
        await expect(createStaticApi("/demo/", cut.fetcher).describe("readme.ts")).rejects.toMatchObject({
            status: 500, code: "INTERNAL", message: "The demo's describe/0.json didn't load (it isn't JSON). Reload the page.",
        });
    });
});

describe("a level asked of a file", () => {
    it("answers as the server does: 400, naming the file's folder; anything else unknown is a 404", async () => {
        const { fetcher, calls } = fake();
        const api = createStaticApi("/demo/", fetcher);
        await expect(api.level("readme.ts")).rejects.toMatchObject({
            status: 400, code: "BAD_REQUEST", message: '"readme.ts" is a file. Open its folder ("") and select it there.',
        });
        await expect(api.level("big/a.ts")).rejects.toMatchObject({
            status: 400, code: "BAD_REQUEST", message: '"big/a.ts" is a file. Open its folder ("big") and select it there.',
        });
        await expect(api.level("big/missing.ts")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: 'Nothing is indexed at "big/missing.ts".' });
        await expect(api.level("nope/x.ts")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
        // a name an object inherits ("constructor") isn't a file
        await expect(api.level("constructor")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
        await expect(api.describe("constructor")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
        // the check reads the same bundle describe does, once
        await api.describe("readme.ts");
        expect(calls.filter((c) => c === "/demo/describe/0.json")).toHaveLength(1);
    });
});

describe("the transport's retries and caches", () => {
    it("forgets a bundle that failed to load, so the next describe fetches it again", async () => {
        const flaky = overriding((url, nth) => (url.endsWith("describe/0.json") && nth === 1 ? new TypeError("Failed to fetch") : undefined));
        const api = createStaticApi("/demo/", flaky.fetcher);
        await expect(api.describe("readme.ts")).rejects.toMatchObject({ code: "NETWORK" });
        expect(await api.describe("readme.ts")).toEqual({ path: "readme.ts" });
        expect(flaky.hits("describe/0.json")).toBe(2);
    });

    it("fetches a bundle once for describes that overlap", async () => {
        const { fetcher, calls } = fake();
        const api = createStaticApi("/demo/", fetcher);
        const answers = await Promise.all([api.describe("readme.ts"), api.describe(""), api.describe("readme.ts")]);
        expect(answers).toEqual([{ path: "readme.ts" }, { path: "" }, { path: "readme.ts" }]);
        expect(calls.filter((c) => c === "/demo/describe/0.json")).toHaveLength(1);
    });

    it("tries the manifest again after it failed to load", async () => {
        const flaky = overriding((url, nth) => (url.endsWith("manifest.json") && nth === 1 ? new TypeError("Failed to fetch") : undefined));
        const api = createStaticApi("/demo/", flaky.fetcher);
        await expect(api.status()).rejects.toMatchObject({ code: "NETWORK" });
        expect(await api.status()).toEqual(MANIFEST.status);
        expect(flaky.hits("manifest.json")).toBe(2);
    });

    it("tries the search index again after it failed to load", async () => {
        const flaky = overriding((url, nth) => (url.endsWith("search.json") && nth === 1 ? new Response("down", { status: 503 }) : undefined));
        const api = createStaticApi("/demo/", flaky.fetcher);
        await expect(api.search("alpha", 10)).rejects.toMatchObject({ status: 503, code: "INTERNAL" });
        expect((await api.search("alpha", 10)).hits[0].path).toBe("big/a.ts");
        expect(flaky.hits("search.json")).toBe(2);
    });

    it("keeps a newer bundle when an older request for it fails after the cap evicted it", async () => {
        const ids = Array.from({ length: 101 }, (_, i) => i + 1);   // one folder past the 100 bundles kept
        const files = {
            ...FILES,
            "manifest.json": { ...MANIFEST, folders: ["", ...ids.map((i) => `f${i}`)], pages: {} },
            ...Object.fromEntries(ids.map((i) => [`describe/${i}.json`, { [`f${i}`]: { path: `f${i}` } }])),
        };
        let fail: (err: Error) => void = () => {};
        const slow = overriding((url, nth) => (url === "/demo/describe/1.json" && nth === 1 ? new Promise<Response>((_, reject) => { fail = reject; }) : undefined), files);
        const api = createStaticApi("/demo/", slow.fetcher);

        const first = api.describe("f1").catch((e: unknown) => e);
        await vi.waitFor(() => expect(slow.hits("describe/1.json")).toBe(1));
        for (const i of ids.slice(1)) await api.describe(`f${i}`);   // the 101st bundle evicts f1's, still loading
        expect(await api.describe("f1")).toEqual({ path: "f1" });   // asked for again: a second fetch
        fail(new TypeError("Failed to fetch"));
        expect(await first).toMatchObject({ code: "NETWORK" });

        expect(await api.describe("f1")).toEqual({ path: "f1" });
        expect(slow.hits("describe/1.json")).toBe(2);   // the newer entry outlived the old failure
    });
});
