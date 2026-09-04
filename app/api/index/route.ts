import { NextResponse } from "next/server";
import { indexRepo, IndexLockedError } from "@/lib/index-repo";
import { getIndexStatus } from "@/lib/index-status";
import type { ErrorCode, IndexEventMap } from "@/lib/contracts";

export const runtime = "nodejs";

// helper to send SSE events — see docs/API_CONTRACTS.md §4
function sendEvent<K extends keyof IndexEventMap>(event: K, data: IndexEventMap[K]){
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(){
    const encoder = new TextEncoder();
    const repoRoot = process.cwd();
    const startTime = Date.now();

    const stream = new ReadableStream({
        async start(controller){
            const send = <K extends keyof IndexEventMap>(event: K, data: IndexEventMap[K]) => {
                controller.enqueue(encoder.encode(sendEvent(event, data)));
            };

            try{
                const stats = await indexRepo(repoRoot, {
                    onProgress: (phase, done, total, currentFile) => {
                        send("progress", { phase, done, total, currentFile });
                    }
                });

                const status = getIndexStatus(repoRoot);

                send("done", {
                    fileCount: stats.changed + stats.skipped,
                    chunkCount: status.chunkCount,
                    skippedUnchanged: stats.skipped,
                    tookMs: Date.now() - startTime,
                    // beyond API_CONTRACTS.md §4's four required fields: per-file
                    // failures that would otherwise be invisible, since one bad
                    // file no longer sinks the run
                    changed: stats.changed,
                    errors: stats.errors,
                    warnings: stats.warnings
                });

                controller.close();
            } catch (err){
                const error = err instanceof Error ? err : new Error(String(err));

                // classify on the error's TYPE, not on its message text — a
                // reworded sentence must not silently change the error code
                let code: ErrorCode = "INTERNAL";

                if (err instanceof IndexLockedError){
                    code = "INDEX_LOCKED";
                } else if (error.message.includes("Repository not found")){
                    code = "NOT_FOUND";
                }

                send("error", { code, message: error.message });
                controller.close();
            }
        }
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive"
        }
    });
}
