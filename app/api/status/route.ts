import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { readIndexStatus } from "@/lib/engine/status";
import type { ErrorEnvelope, IndexStatus } from "@/lib/contracts";

export const runtime = "nodejs";

// GET /api/status — what each indexing stage of the active repo is doing (API_CONTRACTS.md §9)
export function GET(){
    const { activeRepo } = readConfig();
    const status = activeRepo ? readIndexStatus(activeRepo) : null;

    if (!status){
        return NextResponse.json<ErrorEnvelope>(
            { error: { code: "INDEX_EMPTY", message: "No repository indexed yet. Run npm run index -- <path-to-repo>." } },
            { status: 404 }
        );
    }

    return NextResponse.json<IndexStatus>(status);
}
