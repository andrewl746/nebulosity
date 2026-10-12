import { NextRequest, NextResponse } from "next/server";
import type { DescribeResponse } from "@/lib/contracts";
import { describe } from "@/lib/engine/describe";
import { parseRepoPath } from "@/lib/index/paths";
import { summariesEnabled } from "@/lib/index/summarize/env";
import { activeRepo, badPath, errorJson, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/describe?path= — what a folder or file is, what's inside, what it uses and what uses it (API_CONTRACTS.md §12)
export function GET(request: NextRequest){
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const target = parseRepoPath(request.nextUrl.searchParams.get("path") ?? "");
    if (target === null) return badPath();

    try{
        return NextResponse.json<DescribeResponse>(describe(repo, target, { summariesOff: !summariesEnabled() }));
    } catch (err){
        return errorJson(err);
    }
}
