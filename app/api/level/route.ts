import { NextRequest, NextResponse } from "next/server";
import type { LevelResponse } from "@/lib/contracts";
import { level } from "@/lib/engine/level";
import { parseRepoPath } from "@/lib/index/paths";
import { summariesEnabled } from "@/lib/index/summarize/env";
import { activeRepo, badPath, errorJson, jsonError, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/level?path=&page= — one folder of the Map, a page of at most 50 boxes (API_CONTRACTS.md §11)
export function GET(request: NextRequest){
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const folder = parseRepoPath(request.nextUrl.searchParams.get("path") ?? "");
    if (folder === null) return badPath();
    const page = request.nextUrl.searchParams.get("page") ?? "0";
    if (!/^\d+$/.test(page)) return jsonError(400, "BAD_REQUEST", "page must be a whole number, from 0.");

    try{
        return NextResponse.json<LevelResponse>(level(repo, folder, { summariesOff: !summariesEnabled(), page: Number(page) }));
    } catch (err){
        return errorJson(err);
    }
}
