import { describe, expect, it } from "vitest";
import { classifyRepos } from "./serverCheck";

describe("classifyRepos (who answers GET /api/repos on the port, Review Focus 5)", () => {
    it("knows a current Nebulosity, an older one and one on another bridge", () => {
        const body = { active: null, repos: [], server: { version: "0.3.0", bridge: 1 } };
        expect(classifyRepos(200, body).kind).toBe("current");
        expect(classifyRepos(200, body)).toEqual({ kind: "current", list: body });
        expect(classifyRepos(200, { active: null, repos: [] })).toEqual({ kind: "old" });
        expect(classifyRepos(200, { active: null, repos: [], server: { version: "0.4.0", bridge: 2 } })).toEqual({ kind: "mismatch", bridge: 2 });
    });

    it("calls anything else another app", () => {
        expect(classifyRepos(200, "<html>")).toEqual({ kind: "foreign" });
        expect(classifyRepos(404, { error: { code: "NOT_FOUND" } })).toEqual({ kind: "foreign" });
        expect(classifyRepos(200, { repos: "x" })).toEqual({ kind: "foreign" });
        expect(classifyRepos(500, null)).toEqual({ kind: "foreign" });
    });
});
