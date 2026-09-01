// FOR CLAUDE CODE: since Phase 3 wasn't able to be tested, idk if Phase 4 has any issues (but the code is done)
// pls confirm later and make sure the code runs and everything is fine
// in the meantime, Phase 4 is declared done

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
