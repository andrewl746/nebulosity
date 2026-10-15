import { NextResponse } from "next/server";
import type { ErrorCode, ErrorEnvelope } from "@/lib/contracts";
import { readConfig } from "@/lib/config";
import { errorResponseFor, NoActiveRepoError } from "@/lib/engine/errors";

/** Shared by the route handlers: the error envelope (API_CONTRACTS.md §1) and the active repo. */
export function jsonError(status: number, code: ErrorCode, message: string): NextResponse<ErrorEnvelope> {
    return NextResponse.json<ErrorEnvelope>({ error: { code, message } }, { status });
}

/** An engine error as its envelope. Unexpected ones are logged here, where the stack is still at hand. */
export function errorJson(err: unknown): NextResponse<ErrorEnvelope> {
    const { status, error } = errorResponseFor(err);
    if (status === 500) console.error(err);
    return NextResponse.json<ErrorEnvelope>({ error }, { status });
}

/** The repo the Map shows: `activeRepo` in the data folder's config.json, which nebulosity index sets. */
export function activeRepo(): string | null {
    return readConfig().activeRepo;
}

export function noActiveRepo(): NextResponse<ErrorEnvelope> {
    return jsonError(404, "INDEX_EMPTY", new NoActiveRepoError().message);
}

export function badPath(): NextResponse<ErrorEnvelope> {
    return jsonError(400, "BAD_REQUEST", "path must be repo-relative: forward slashes, no '..', and empty for the repo root.");
}

export function forbidden(): NextResponse<ErrorEnvelope> {
    return jsonError(403, "FORBIDDEN", "This endpoint only takes requests from this machine, and from no other web page.");
}
