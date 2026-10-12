import { NextRequest, NextResponse } from "next/server";
import type { SearchResult } from "@/lib/contracts";
import { search } from "@/lib/engine/search";
import { activeRepo, errorJson, jsonError, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/search?q=&limit= — hybrid search over the active repo: files and folders, fused with RRF (API_CONTRACTS.md §10)
export async function GET(request: NextRequest){
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (query === "") return jsonError(400, "BAD_REQUEST", "Missing query parameter 'q'.");
    // 10 by default, at most 50: each list contributes 50 at most anyway
    const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 10));

    try{
        return NextResponse.json<SearchResult>(await search(repo, query, { limit }));
    } catch (err){
        return errorJson(err);
    }
}
