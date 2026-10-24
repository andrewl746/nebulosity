import { describe, expect, it } from "vitest";
import { afterPoll, afterProbe, classifyRepos, type ServerCheck } from "./serverCheck";

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

describe("afterProbe (what Show Map does once the port has answered, or not)", () => {
    const current: ServerCheck = { kind: "current", list: { active: null, repos: [], server: { version: "0.3.0", bridge: 1 } } };

    it("uses whoever answers, installed or not: a running Map needs no nebulosity command", () => {
        expect(afterProbe(current, false, false)).toEqual({ kind: "use", check: current });
        expect(afterProbe(current, true, false)).toEqual({ kind: "use", check: current });
        expect(afterProbe({ kind: "foreign" }, false, false)).toEqual({ kind: "use", check: { kind: "foreign" } });
        expect(afterProbe({ kind: "old" }, false, false)).toEqual({ kind: "use", check: { kind: "old" } });
        expect(afterProbe({ kind: "mismatch", bridge: 2 }, true, false)).toEqual({ kind: "use", check: { kind: "mismatch", bridge: 2 } });
    });

    it("says not installed only when a Map would have to be started", () => {
        expect(afterProbe("refused", false, false)).toEqual({ kind: "notInstalled" });
        expect(afterProbe("refused", true, false)).toEqual({ kind: "start" });
    });

    it("waits on a port that's held but not answering yet, and on this window's own Map still coming up", () => {
        expect(afterProbe("timeout", false, false)).toEqual({ kind: "wait" });
        expect(afterProbe("timeout", true, false)).toEqual({ kind: "wait" });
        expect(afterProbe("refused", true, true)).toEqual({ kind: "waitOwn" });
        expect(afterProbe("timeout", true, true)).toEqual({ kind: "waitOwn" });
        expect(afterProbe("refused", false, true)).toEqual({ kind: "waitOwn" });
    });
});

describe("afterPoll (the start poll, after each probe, PR #10 review 5)", () => {
    const current: ServerCheck = { kind: "current", list: { active: null, repos: [], server: { version: "0.3.0", bridge: 1 } } };

    it("uses whoever answers, and polls on while nothing does and this window's Map is still running", () => {
        expect(afterPoll(current, false, 0)).toEqual({ kind: "use", check: current });
        expect(afterPoll({ kind: "foreign" }, false, 0)).toEqual({ kind: "use", check: { kind: "foreign" } });
        expect(afterPoll("refused", false, 0)).toEqual({ kind: "poll" });
        expect(afterPoll("timeout", false, 0)).toEqual({ kind: "poll" });
    });

    it("uses a Map that answers after this window's own ended: another window started it first (EADDRINUSE here)", () => {
        expect(afterPoll(current, true, 0)).toEqual({ kind: "use", check: current });
        expect(afterPoll(current, true, 1)).toEqual({ kind: "use", check: current });
    });

    it("once this window's Map ended, asks a refused port once more after a poll, and fails on the second refusal", () => {
        expect(afterPoll("refused", true, 1)).toEqual({ kind: "poll" });
        expect(afterPoll("refused", true, 2)).toEqual({ kind: "fail" });
    });

    it("waits on a port that's held but silent after this window's Map ended: the winner's Map still coming up", () => {
        expect(afterPoll("timeout", true, 0)).toEqual({ kind: "poll" });
        expect(afterPoll("timeout", true, 1)).toEqual({ kind: "poll" });
    });
});
