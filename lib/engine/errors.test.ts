import { describe, expect, it } from "vitest";
import { IndexLockedError } from "../db/store/lock";
import { RepoNotIndexedError } from "../db/store/structure";
import { StructureNotReadyError, TargetNotFoundError, TargetNotReadyError, UnknownBatchError } from "../index/summarize/run";
import { SummarizerAuthError } from "../index/summarize/types";
import { errorResponseFor, NoActiveRepoError, RepoSwitchingError, SummariesOffError } from "./errors";
import { NotAFolderError, PathNotFoundError } from "./level";

describe("errorResponseFor", () => {
    it("gives each engine error its code and status, and keeps its message", () => {
        const cases: [Error, string, number][] = [
            [new RepoNotIndexedError("/r"), "INDEX_EMPTY", 404],
            [new NoActiveRepoError(), "INDEX_EMPTY", 404],
            [new PathNotFoundError("x"), "NOT_FOUND", 404],
            [new TargetNotFoundError("x"), "NOT_FOUND", 404],
            [new UnknownBatchError("b"), "NOT_FOUND", 404],
            [new NotAFolderError("a/b.ts"), "BAD_REQUEST", 400],
            [new IndexLockedError("2026-10-12T00:00:00.000Z"), "INDEX_LOCKED", 409],
            [new StructureNotReadyError("running"), "INDEX_LOCKED", 409],
            [new TargetNotReadyError("src"), "NOT_READY", 409],
            [new SummariesOffError(), "SUMMARIES_OFF", 409],
            [new SummarizerAuthError("invalid x-api-key"), "UPSTREAM", 502],
            [new RepoSwitchingError("C:/b", "C:/a"), "INDEX_LOCKED", 409],
        ];
        for (const [err, code, status] of cases){
            expect(errorResponseFor(err)).toEqual({ status, error: { code, message: err.message } });
        }
    });

    it("calls anything else an internal error and says what it was", () => {
        expect(errorResponseFor(new Error("disk full"))).toEqual({ status: 500, error: { code: "INTERNAL", message: "Internal error: disk full" } });
        expect(errorResponseFor("odd")).toEqual({ status: 500, error: { code: "INTERNAL", message: "Internal error: odd" } });
    });
});
