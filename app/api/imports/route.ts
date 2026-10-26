import { NextRequest, NextResponse } from "next/server";
import type { ImportsResponse } from "@/lib/contracts";
import { cachedReach, importsPage, parseImportsQuery } from "@/lib/engine/imports-page";
import { activeRepo, errorJson, jsonError, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/imports?path=&direction=&transitive=&limit=&offset= — a page of the files that import a file or folder, or that it imports (API_CONTRACTS.md §19)
export function GET(request: NextRequest){
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const query = parseImportsQuery(request.nextUrl.searchParams);
    if ("error" in query) return jsonError(400, "BAD_REQUEST", query.error);

    try{
        return NextResponse.json<ImportsResponse>(importsPage(cachedReach(repo, query.path, query.direction), query));
    } catch (err){
        return errorJson(err);
    }
}
