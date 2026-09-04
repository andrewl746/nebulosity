// Verified 2026-09-04 (RAG Review #1). Retrieval quality measured against the five
// acceptance queries in IMPLEMENTATION_ROADMAP.md Phase 4 — all five now return the
// expected chunk at rank 1. The algorithm in lib/retrieve.ts needed no changes; only
// the BLOB decode was wrong (ADR-017). The one query that originally failed did so
// because a JSDoc comment had drifted onto the wrong declaration in lib/graph.ts —
// once code is embedded, a misplaced comment is a retrieval bug (LEARNING_NOTES.md §14).

import { NextRequest, NextResponse } from "next/server";
import { retrieve, getVectorCache } from "@/lib/retrieve";
import type { SearchResponse, ErrorEnvelope } from "@/lib/contracts";

export async function GET(request: NextRequest){
    const q = request.nextUrl.searchParams.get("q");

    if (!q || q.trim() === ""){
        return NextResponse.json<ErrorEnvelope>(
        { error: { code: "BAD_REQUEST", message: "Missing query parameter 'q'" } },
        { status: 400 }
        );
    }

    try{
        const cache = await getVectorCache();

        // check if an index exists
        if (!cache.lastIndexAtMs){
            return NextResponse.json<ErrorEnvelope>(
                {
                error: {
                    code: "INDEX_EMPTY",
                    message: "No index found. Please run POST /api/index first.",
                },
                },
                { status: 404 }
            );
        }

        // return the top k chunks that have the most similar meaning to the query
        const results = await retrieve(q);

        return NextResponse.json<SearchResponse>({ results });
    } catch (err){
        console.error("Search error:", err);

        return NextResponse.json<ErrorEnvelope>(
            { error: { code: "INTERNAL", message: "Internal server error during search" } },
            { status: 500 }
        );
    }
}
