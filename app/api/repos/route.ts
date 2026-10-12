import { NextRequest, NextResponse } from "next/server";
import type { RepoList } from "@/lib/contracts";
import { workerOn } from "@/lib/background/start";
import { listRepos, setActiveRepo } from "@/lib/engine/repos";
import { isLocalRequest } from "@/lib/live/local";
import { errorJson, forbidden, jsonError } from "../_lib/respond";

export const runtime = "nodejs";

// GET /api/repos — the indexed repos and the active one; POST { root } switches (API_CONTRACTS.md §15)
export function GET(){
    return NextResponse.json<RepoList>(listRepos());
}

export async function POST(request: NextRequest){
    if (!isLocalRequest(request.headers)) return forbidden();
    const body = (await request.json().catch(() => null)) as { root?: unknown } | null;
    if (typeof body?.root !== "string") return jsonError(400, "BAD_REQUEST", "Expected { root }: an indexed repository's root.");

    try{
        const list = setActiveRepo(body.root);
        workerOn(list.active);   // the worker watches the new repo from now on
        return NextResponse.json<RepoList>(list);
    } catch (err){
        return errorJson(err);
    }
}
