import path from "path";
import { describe, expect, it } from "vitest";
import { DatabaseMissingError, DatabaseOutdatedError } from "../db/client";
import { dataDir } from "../home";
import { IndexLockedError } from "../db/store/lock";
import { RepoNotIndexedError } from "../db/store/structure";
import { StructureNotReadyError, TargetNotFoundError, TargetNotReadyError, UnknownBatchError } from "../index/summarize/run";
import { SummaryModelsError } from "../index/summarize/models";
import { ModelUnavailableError, SummarizerAuthError } from "../index/summarize/types";
import { BadInputError, errorResponseFor, NoActiveRepoError, RepoSwitchingError, SummariesNotConfirmedError, SummariesOffError } from "./errors";
import { NotAFolderError, PathNotFoundError } from "./level";
import { UnknownRepoError } from "./repos";

describe("errorResponseFor", () => {
    it("gives each engine error its code and status, and keeps its message", () => {
        const cases: [Error, string, number][] = [
            [new RepoNotIndexedError("/r"), "INDEX_EMPTY", 404],
            [new NoActiveRepoError(), "INDEX_EMPTY", 404],
            [new PathNotFoundError("x"), "NOT_FOUND", 404],
            [new TargetNotFoundError("x"), "NOT_FOUND", 404],
            [new UnknownBatchError("b"), "NOT_FOUND", 404],
            [new NotAFolderError("a/b.ts"), "BAD_REQUEST", 400],
            [new BadInputError("Pick two places side by side."), "BAD_REQUEST", 400],
            [new IndexLockedError("2026-10-12T00:00:00.000Z"), "INDEX_LOCKED", 409],
            [new StructureNotReadyError("running"), "INDEX_LOCKED", 409],
            [new TargetNotReadyError("src"), "NOT_READY", 409],
            [new SummariesOffError(), "SUMMARIES_OFF", 409],
            [new SummariesNotConfirmedError("/r"), "SUMMARIES_OFF", 409],
            [new SummarizerAuthError("invalid x-api-key"), "UPSTREAM", 502],
            // ADR-066: Anthropic no longer serves the model, upstream like a rejected key; a setting that can't be used turns summaries off
            [new ModelUnavailableError("claude-haiku-5-5", "model: claude-haiku-5-5"), "UPSTREAM", 502],
            [new SummaryModelsError("summaryModels.file.inputPerMTok is missing"), "SUMMARIES_OFF", 409],
            [new RepoSwitchingError("C:/b", "C:/a"), "INDEX_LOCKED", 409],
            [new DatabaseMissingError("/home/.nebulosity/nebulosity.db"), "INDEX_EMPTY", 404],
            [new DatabaseOutdatedError(), "NOT_READY", 409],
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

describe("what the errors tell a user to do, installed or in a checkout (ADR-058)", () => {
    const INDEX = "nebulosity index <path-to-repo> (in a checkout: npm run index -- <path-to-repo>)";

    it("names the nebulosity command beside the checkout's npm script", () => {
        expect(new NoActiveRepoError().message).toBe(`No repository indexed yet. Run ${INDEX}.`);
        expect(new DatabaseMissingError("/home/.nebulosity/nebulosity.db").message)
            .toBe(`No repository indexed yet: there's no index at /home/.nebulosity/nebulosity.db. Run ${INDEX}.`);
        expect(new DatabaseOutdatedError().message)
            .toBe(`Nebulosity's index is older than this version of Nebulosity. Run ${INDEX} once, or start the Map (nebulosity map; in a checkout, npm run dev), to update it, then try again.`);
        expect(new RepoNotIndexedError("/r/app").message).toBe('/r/app isn\'t indexed yet. Run nebulosity index "/r/app" (in a checkout: npm run index -- "/r/app") first.');
        expect(new UnknownRepoError("/r/app").message).toBe('/r/app isn\'t an indexed repository. Run nebulosity index "/r/app" (in a checkout: npm run index -- "/r/app") first.');
        expect(new TargetNotReadyError("src").message).toBe("\"src\" can't be summarized yet: some of its files or subfolders have no summary, and a folder's summary is written from theirs."
            + " Run nebulosity summarize <path-to-repo> (in a checkout: npm run summarize -- <path-to-repo>), or open them first.");
    });

    it("says where the key goes: the environment, or the data folder's .env.local", () => {
        expect(new SummariesOffError().message)
            .toBe(`Summaries are off: ANTHROPIC_API_KEY is not set (set it in the environment, or put it in ${path.join(dataDir(), ".env.local")}, then restart the Map).`);
    });
});
