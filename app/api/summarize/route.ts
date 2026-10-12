import { NextRequest, NextResponse } from "next/server";
import type { ErrorEnvelope, SummarizeResponse } from "@/lib/contracts";
import { workerOn } from "@/lib/background/start";
import { STATUS_FOR } from "@/lib/engine/errors";
import { parseRepoPath } from "@/lib/index/paths";
import { isLocalRequest } from "@/lib/live/local";
import { activeRepo, badPath, forbidden, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// POST /api/summarize?path= — summarize one file or folder now, jumping the queue (API_CONTRACTS.md §13).
// It spends money, so only this machine may ask.
export async function POST(request: NextRequest){
    if (!isLocalRequest(request.headers)) return forbidden();
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const target = parseRepoPath(request.nextUrl.searchParams.get("path"));
    if (target === null) return badPath();

    // the repo the Map shows goes with the request: the worker refuses it rather than summarize another repo's path
    const outcome = await workerOn(repo).summarize(target, repo);
    if (!outcome.ok) return NextResponse.json<ErrorEnvelope>({ error: outcome.error }, { status: STATUS_FOR[outcome.error.code] });
    return NextResponse.json<SummarizeResponse>(outcome.summary);
}
