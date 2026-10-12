import { NextRequest, NextResponse } from "next/server";
import type { LevelResponse } from "@/lib/contracts";
import { level } from "@/lib/engine/level";
import { parseRepoPath } from "@/lib/index/paths";
import { summariesEnabled } from "@/lib/index/summarize/env";
import { activeRepo, badPath, errorJson, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/level?path= — one folder of the Map, folded to 50 boxes (API_CONTRACTS.md §11)
export function GET(request: NextRequest){
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const folder = parseRepoPath(request.nextUrl.searchParams.get("path") ?? "");
    if (folder === null) return badPath();

    try{
        return NextResponse.json<LevelResponse>(level(repo, folder, { summariesOff: !summariesEnabled() }));
    } catch (err){
        return errorJson(err);
    }
}
