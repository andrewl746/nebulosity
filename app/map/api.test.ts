import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, levelUrl, parseSseFrames } from "./api";

afterEach(() => { vi.unstubAllGlobals(); });

describe("parseSseFrames", () => {
    it("splits whole frames, joins multi-line data, skips comments, and keeps a cut-off frame for the next chunk", () => {
        const { frames, rest } = parseSseFrames('event: tool\ndata: {"a":1}\n\n: keep-alive\n\nevent: x\ndata: one\ndata: two\n\nevent: half\ndata: {"b"');
        expect(frames).toEqual([{ event: "tool", data: '{"a":1}' }, { event: "x", data: "one\ntwo" }]);
        expect(rest).toBe('event: half\ndata: {"b"');
    });
});

describe("api", () => {
    it("percent-encodes paths, so spaces, #, %, + and non-ASCII letters reach the server intact", () => {
        expect(levelUrl("src/my file#1%+é.ts")).toBe("/api/level?path=src%2Fmy%20file%231%25%2B%C3%A9.ts");
    });

    it("turns an error envelope into an ApiError with the server's code, and a dead server into NETWORK", async () => {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Nothing is indexed at \"x\"." } }), { status: 404 }));
        await expect(api.describe("x")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Nothing is indexed at \"x\"." });

        vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
        await expect(api.level("")).rejects.toBeInstanceOf(ApiError);
        await expect(api.level("")).rejects.toMatchObject({ code: "NETWORK" });
    });
});
