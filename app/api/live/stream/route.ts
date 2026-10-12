import { subscribe } from "@/lib/live/hub";
import { SSE_HEADERS, SSE_KEEP_ALIVE, sseFrame } from "@/lib/live/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 15_000;

// GET /api/live/stream — every live event, as Server-Sent Events, for as long as the Map stays open (API_CONTRACTS.md §14)
export function GET(request: Request){
    const encoder = new TextEncoder();
    let stop = (): void => {};

    const stream = new ReadableStream<Uint8Array>({
        start(controller){
            const write = (text: string): void => controller.enqueue(encoder.encode(text));
            write(sseFrame("ready", {}));

            const unsubscribe = subscribe((event) => write(sseFrame("tool", event)));
            const keepAlive = setInterval(() => {
                try{
                    write(SSE_KEEP_ALIVE);
                } catch{
                    stop();   // the stream closed without an abort reaching us
                }
            }, KEEP_ALIVE_MS);
            stop = () => {
                unsubscribe();
                clearInterval(keepAlive);
            };

            request.signal.addEventListener("abort", () => {
                stop();
                try{
                    controller.close();
                } catch{
                    // already closed
                }
            });
        },
        cancel(){
            stop();
        },
    });

    return new Response(stream, { headers: SSE_HEADERS });
}
