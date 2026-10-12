import { NextResponse } from "next/server";
import { workerOn } from "@/lib/background/start";
import { readConfig } from "@/lib/config";
import { readIndexStatus } from "@/lib/engine/status";
import type { ErrorEnvelope, IndexStatus } from "@/lib/contracts";

export const runtime = "nodejs";

// GET /api/status — what each indexing stage of the active repo is doing (API_CONTRACTS.md §9)
export function GET(){
    const { activeRepo } = readConfig();
    // the Map polls this every 2 s, so a repo npm run index made active reaches the worker within one poll (C1)
    workerOn(activeRepo);
    const status = activeRepo ? readIndexStatus(activeRepo) : null;

    if (!status){
        return NextResponse.json<ErrorEnvelope>(
            { error: { code: "INDEX_EMPTY", message: "No repository indexed yet. Run npm run index -- <path-to-repo>." } },
            { status: 404 }
        );
    }

    return NextResponse.json<IndexStatus>(status);
}
