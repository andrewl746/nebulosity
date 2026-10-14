import path from "path";
import { describe, expect, it } from "vitest";
import { resolveRequest } from "./resolve-request";

const root = path.resolve("/srv/demo-out");
const inside = (...parts: string[]): string => path.join(root, ...parts);

describe("resolveRequest", () => {
    it("serves index.html for / and ignores the query string and the fragment", () => {
        expect(resolveRequest("/", root)).toBe(inside("index.html"));
        expect(resolveRequest("/?path=src/vs/platform&page=2", root)).toBe(inside("index.html"));
        expect(resolveRequest("/index.html?x=1#top", root)).toBe(inside("index.html"));
    });

    it("maps a path to a file under the root, decoding it", () => {
        expect(resolveRequest("/demo/level/0-0.json", root)).toBe(inside("demo", "level", "0-0.json"));
        expect(resolveRequest("/_next/static/chunks/a%20b.js", root)).toBe(inside("_next", "static", "chunks", "a b.js"));
    });

    it("lets a .. that stays inside the root through", () => {
        expect(resolveRequest("/demo/../index.html", root)).toBe(inside("index.html"));
    });

    it("says null for anything that leaves the root, however the .. is written", () => {
        expect(resolveRequest("/../package.json", root)).toBeNull();
        expect(resolveRequest("/%2e%2e/package.json", root)).toBeNull();
        expect(resolveRequest("/..%2fpackage.json", root)).toBeNull();
        expect(resolveRequest("/%5c..%5cpackage.json", root)).toBeNull();
        expect(resolveRequest("/a/..\\..\\package.json", root)).toBeNull();
    });

    it("says null for the root itself, which isn't a file", () => {
        expect(resolveRequest("/demo/..", root)).toBeNull();
    });

    it('says "bad" for a malformed % escape, a NUL, and a target that isn\'t a path', () => {
        expect(resolveRequest("/%", root)).toBe("bad");
        expect(resolveRequest("/%E0%A4%A", root)).toBe("bad");
        expect(resolveRequest("/%00", root)).toBe("bad");
        expect(resolveRequest("*", root)).toBe("bad");
        expect(resolveRequest("http://evil.example/x", root)).toBe("bad");
    });
});
