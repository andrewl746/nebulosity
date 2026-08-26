// i made console display the events and the data (im not sure if we have to implement it into the ui later, lmk)

import { NextResponse } from "next/server";
import { indexRepo } from "@/lib/index-repo";

export const runtime = "nodejs";

export async function POST(){
    const encoder = new TextEncoder();
    const repoRoot = process.cwd();

    // helper to send SSE events
    function sendEvent(event: string, data: unknown){
        return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    }

    const stream = new ReadableStream({
        async start(controller){
            try{
                // start indexing
                const stats = await indexRepo(repoRoot, {
                    onProgress: (phase, done, total) => {
                        // event that streams progress to the client
                        controller.enqueue(
                            encoder.encode(
                                sendEvent("progress", { phase, done, total })
                            )
                        );
                    }
                });

                // event that streams when the indexing is done (including stats)
                controller.enqueue(
                    encoder.encode(
                        sendEvent("done", {
                            changed: stats.changed,
                            skipped: stats.skipped,
                            errors: stats.errors,
                            warnings: stats.warnings,
                        })
                    )
                );

                controller.close();
            } catch (err){
                // handle errors
                const error = err instanceof Error ? err : new Error(String(err));
                let code = "INTERNAL";

                if (error.message.includes("INDEX_LOCKED")) {
                    code = "INDEX_LOCKED";
                } else if (error.message.includes("Repository not found")) {
                    code = "NOT_FOUND";
                }

                controller.enqueue(
                    encoder.encode(
                        sendEvent("error", { code, message: error.message })
                    )
                );

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