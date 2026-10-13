import type { ErrorCode } from "../contracts";
import { DatabaseMissingError, DatabaseOutdatedError } from "../db/client";
import { IndexLockedError } from "../db/store/lock";
import { RepoNotIndexedError } from "../db/store/structure";
import { StructureNotReadyError, TargetNotFoundError, TargetNotReadyError, UnknownBatchError } from "../index/summarize/run";
import { SummarizerAuthError } from "../index/summarize/types";
import { NotAFolderError, PathNotFoundError } from "./level";
import { UnknownRepoError } from "./repos";

/** Thrown when a summary is asked for and there's no API key to write it with. */
export class SummariesOffError extends Error {
    constructor(){
        super("Summaries are off: ANTHROPIC_API_KEY is not set (put it in .env.local and restart the server).");
        this.name = "SummariesOffError";
    }
}

/** Thrown when there's no active repo: nothing has been indexed yet. */
export class NoActiveRepoError extends Error {
    constructor(){
        super("No repository indexed yet. Run npm run index -- <path-to-repo>.");
        this.name = "NoActiveRepoError";
    }
}

/**
 * Thrown when a request is for a repo the background worker isn't on (yet). The worker follows the active repo
 * (ADR-038, amended), so a request made just after a switch can reach it before it has moved; acting anyway would
 * summarize or re-index the wrong repo.
 */
export class RepoSwitchingError extends Error {
    constructor(wanted: string, current: string | null){
        super(`The background worker is on ${current ?? "no repository"}, not ${wanted}; it's switching now, so try again in a moment.`);
        this.name = "RepoSwitchingError";
    }
}

/** Each error code's HTTP status (API_CONTRACTS.md §1). */
export const STATUS_FOR: Readonly<Record<ErrorCode, number>> = {
    BAD_REQUEST: 400,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INDEX_EMPTY: 404,
    INDEX_LOCKED: 409,
    NOT_READY: 409,
    SUMMARIES_OFF: 409,
    BUDGET_EXCEEDED: 429,
    UPSTREAM: 502,
    INTERNAL: 500,
};

/**
 * What an engine error means over HTTP: its code, its status, and the message to show. Errors are told apart by their
 * type, never their wording, so rewording a message can't change a code. Anything unexpected is INTERNAL.
 */
export function errorResponseFor(err: unknown): { status: number; error: { code: ErrorCode; message: string } } {
    const code = codeFor(err);
    const message = err instanceof Error ? err.message : String(err);
    return { status: STATUS_FOR[code], error: { code, message: code === "INTERNAL" ? `Internal error: ${message}` : message } };
}

function codeFor(err: unknown): ErrorCode {
    if (err instanceof RepoNotIndexedError || err instanceof NoActiveRepoError || err instanceof DatabaseMissingError) return "INDEX_EMPTY";
    if (err instanceof PathNotFoundError || err instanceof TargetNotFoundError || err instanceof UnknownBatchError || err instanceof UnknownRepoError){
        return "NOT_FOUND";
    }
    if (err instanceof NotAFolderError) return "BAD_REQUEST";
    if (err instanceof IndexLockedError || err instanceof StructureNotReadyError || err instanceof RepoSwitchingError) return "INDEX_LOCKED";
    if (err instanceof TargetNotReadyError || err instanceof DatabaseOutdatedError) return "NOT_READY";
    if (err instanceof SummariesOffError) return "SUMMARIES_OFF";
    // Anthropic refused the key: the fault is upstream of this server, and retrying won't help until the key changes
    if (err instanceof SummarizerAuthError) return "UPSTREAM";
    return "INTERNAL";
}
