import { NextRequest, NextResponse } from "next/server";
import type { SourceResponse } from "@/lib/contracts";
import { readSource } from "@/lib/engine/source";
import { parseRepoPath } from "@/lib/index/paths";
import { activeRepo, badPath, errorJson, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/source?path= — an indexed file's text, for the source viewer (API_CONTRACTS.md §16)
export function GET(request: NextRequest){
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const target = parseRepoPath(request.nextUrl.searchParams.get("path") ?? "");
    if (target === null || target === "") return badPath();

    try{
        return NextResponse.json<SourceResponse>(readSource(repo, target));
    } catch (err){
        return errorJson(err);
    }
}
