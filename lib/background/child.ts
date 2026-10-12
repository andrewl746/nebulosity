import type { IndexEventMap, SummarizeResponse } from "../contracts";
import type { StoredSummary } from "../db/store/summaries";
import { errorResponseFor } from "../engine/errors";
import type { IndexResult } from "../index/pipeline";
import type { ChildMessage, ParentMessage } from "./protocol";
import type { BackgroundService } from "./service";

/** POST /api/summarize's answer, from the row summarizeNow returns. */
export function toSummarizeResponse(row: StoredSummary): SummarizeResponse {
    return {
        path: row.path,
        kind: row.kind,
        ...(row.tagline ? { tagline: row.tagline, summary: row.summary ?? "" } : {}),
        summaryStatus: row.status,
        ...(row.status === "failed" && row.error ? { summaryError: row.error } : {}),
    };
}

/** POST /api/index's `done` event, from a structure run's result. */
export function toIndexDone(result: IndexResult): IndexEventMap["done"] {
    return {
        files: result.files,
        changed: result.changed,
        deleted: result.deleted.length,
        edges: result.edges,
        folders: result.folders,
        levelEdges: result.levelEdges,
        errors: result.errors,
        skipped: result.skipped.length,
        totalMs: Math.round(result.totalMs),
    };
}

/**
 * Does what one message from the server asks, and answers it. A failure is an answer too, with the code the API
 * shows, so the server never waits on a request the worker dropped.
 */
export async function handleParentMessage(service: BackgroundService, message: ParentMessage, send: (reply: ChildMessage) => void): Promise<void> {
    switch (message.type){
        case "repo":
            await service.setRepo(message.root);
            send({ type: "ready" });
            return;

        case "summarize":
            try{
                send({ type: "summarized", id: message.id, outcome: { ok: true, summary: toSummarizeResponse(await service.summarizeNow(message.path, message.root)) } });
            } catch (err){
                send({ type: "summarized", id: message.id, outcome: { ok: false, error: errorResponseFor(err).error } });
            }
            return;

        case "index":
            try{
                const result = await service.indexNow((stage, done, total) => send({ type: "index-progress", id: message.id, progress: { stage, done, total } }), message.root);
                send({ type: "indexed", id: message.id, outcome: { ok: true, result: toIndexDone(result) } });
            } catch (err){
                send({ type: "indexed", id: message.id, outcome: { ok: false, error: errorResponseFor(err).error } });
            }
            return;
    }
}
