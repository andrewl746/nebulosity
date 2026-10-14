import { describe, expect, it } from "vitest";
import { emailWarning, readEmail } from "./git-email";

describe("readEmail", () => {
    it("gives the address git printed, without the newline", () => {
        expect(readEmail({ status: 0, stdout: "a@b.c\n", stderr: "" })).toEqual({ ok: true, email: "a@b.c" });
    });

    it("gives null when git ran and the key isn't set: git config exits 1 and prints nothing", () => {
        expect(readEmail({ status: 1, stdout: "", stderr: "" })).toEqual({ ok: true, email: null });
    });

    it("gives null when the key is set to nothing: status 0 and an empty line", () => {
        expect(readEmail({ status: 0, stdout: "\n", stderr: "" })).toEqual({ ok: true, email: null });
    });

    it("fails when git couldn't run at all", () => {
        const error = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
        expect(readEmail({ status: null, signal: null, stdout: null, stderr: null, error })).toEqual({ ok: false, reason: "git couldn't run: spawnSync git ENOENT" });
    });

    it("fails on any other exit status, quoting git's first complaint", () => {
        expect(readEmail({ status: 128, stdout: "", stderr: "fatal: bad config line 3 in file /x\nmore\n" }))
            .toEqual({ ok: false, reason: "git exited with status 128: fatal: bad config line 3 in file /x" });
    });

    it("fails with the status alone when git said nothing", () => {
        expect(readEmail({ status: 3, stdout: "", stderr: "" })).toEqual({ ok: false, reason: "git exited with status 3" });
    });

    it("fails when a signal stopped git", () => {
        expect(readEmail({ status: null, signal: "SIGTERM", stdout: "", stderr: "" })).toEqual({ ok: false, reason: "git was stopped by SIGTERM" });
    });

    it("doesn't take status 1 with output for 'not set': that isn't what git config does", () => {
        expect(readEmail({ status: 1, stdout: "oops\n", stderr: "" })).toEqual({ ok: false, reason: "git exited with status 1" });
    });
});

describe("emailWarning", () => {
    it("names the script, the reason, and what the scan now skips", () => {
        expect(emailWarning("build-demo", "git couldn't run: spawnSync git ENOENT"))
            .toBe("[build-demo] git user.email couldn't be read (git couldn't run: spawnSync git ENOENT): the scan won't check for an email");
    });
});
