import { NextRequest } from "next/server";
import type { IndexEventMap } from "@/lib/contracts";
import { workerOn } from "@/lib/background/start";
import { isLocalRequest } from "@/lib/live/local";
import { SSE_HEADERS, sseFrame } from "@/lib/live/sse";
import { activeRepo, forbidden, noActiveRepo } from "../_lib/respond";

export const runtime = "nodejs";

// POST /api/index — a full structure run of the active repo in the background worker, its progress as SSE (API_CONTRACTS.md §4)
export function POST(request: NextRequest){
    if (!isLocalRequest(request.headers)) return forbidden();
    const repo = activeRepo();
    if (repo === null) return noActiveRepo();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        async start(controller){
            const send = <K extends keyof IndexEventMap>(event: K, data: IndexEventMap[K]): void => {
                try{
                    controller.enqueue(encoder.encode(sseFrame(event, data)));
                } catch{
                    // the client left; the run goes on in the worker either way
                }
            };
            const outcome = await workerOn(repo).index((progress) => send("progress", progress), repo);
            if (outcome.ok) send("done", outcome.result);
            else send("error", outcome.error);
            try{
                controller.close();
            } catch{
                // already closed
            }
        },
    });

    return new Response(stream, { headers: SSE_HEADERS });
}
