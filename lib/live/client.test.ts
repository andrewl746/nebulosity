import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../contracts";
import { postLiveEvent } from "./client";

const event: LiveEvent = { tool: "describe", paths: ["src/a.ts"], at: "2026-10-12T00:00:00.000Z" };

describe("postLiveEvent", () => {
    it("posts the event as JSON to the local server's /api/live", async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const fetchFn = (async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;
        expect(await postLiveEvent(event, { port: 4321, fetchFn })).toBe(true);
        expect(calls[0].url).toBe("http://127.0.0.1:4321/api/live");
        expect(calls[0].init.method).toBe("POST");
        expect(JSON.parse(String(calls[0].init.body))).toEqual(event);
    });

    it("says false, without throwing, when no server answers", async () => {
        const fetchFn = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
        expect(await postLiveEvent(event, { port: 4321, fetchFn })).toBe(false);
    });

    it("gives up after the timeout", async () => {
        const fetchFn = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
        })) as unknown as typeof fetch;
        expect(await postLiveEvent(event, { port: 4321, timeoutMs: 20, fetchFn })).toBe(false);
    });
});
