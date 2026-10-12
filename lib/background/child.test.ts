import { describe, expect, it } from "vitest";
import type { StoredSummary } from "../db/store/summaries";
import { SummariesOffError } from "../engine/errors";
import type { IndexResult } from "../index/pipeline";
import { TargetNotReadyError } from "../index/summarize/run";
import { handleParentMessage } from "./child";
import type { ChildMessage } from "./protocol";
import type { BackgroundService } from "./service";

function fakeService(overrides: Partial<BackgroundService>): BackgroundService {
    return {
        setRepo: async () => {},
        summarizeNow: async () => { throw new Error("not expected"); },
        indexNow: async () => { throw new Error("not expected"); },
        idle: async () => {},
        stop: async () => {},
        ...overrides,
    };
}

const row: StoredSummary = {
    id: 4, kind: "file", path: "src/a.ts", tagline: "A thing", summary: "Does it.", model: "m", inputHash: "h", status: "fresh", batchId: null, error: null,
};

describe("handleParentMessage", () => {
    it("answers a summarize request with the summary as the API shows it", async () => {
        const sent: ChildMessage[] = [];
        await handleParentMessage(fakeService({ summarizeNow: async () => row }), { type: "summarize", id: 7, path: "src/a.ts" }, (m) => sent.push(m));
        expect(sent).toEqual([{
            type: "summarized", id: 7,
            outcome: { ok: true, summary: { path: "src/a.ts", kind: "file", tagline: "A thing", summary: "Does it.", summaryStatus: "fresh" } },
        }]);
    });

    it("answers a failed summarize request with the error's code, never by throwing", async () => {
        const sent: ChildMessage[] = [];
        const send = (m: ChildMessage) => sent.push(m);
        await handleParentMessage(fakeService({ summarizeNow: async () => { throw new TargetNotReadyError("src"); } }), { type: "summarize", id: 1, path: "src" }, send);
        await handleParentMessage(fakeService({ summarizeNow: async () => { throw new SummariesOffError(); } }), { type: "summarize", id: 2, path: "src/a.ts" }, send);
        expect(sent.map((m) => (m.type === "summarized" && !m.outcome.ok ? [m.id, m.outcome.error.code] : null))).toEqual([[1, "NOT_READY"], [2, "SUMMARIES_OFF"]]);
    });

    it("forwards a re-index's progress, then its result", async () => {
        const result = { files: 8, changed: 1, deleted: ["x.ts"], edges: 11, folders: 6, levelEdges: 10, errors: [], skipped: [], totalMs: 12.4 } as unknown as IndexResult;
        const service = fakeService({
            indexNow: async (onProgress) => {
                onProgress?.("parse", 4, 8);
                onProgress?.("parse", 8, 8);
                return result;
            },
        });
        const sent: ChildMessage[] = [];
        await handleParentMessage(service, { type: "index", id: 3 }, (m) => sent.push(m));
        expect(sent).toEqual([
            { type: "index-progress", id: 3, progress: { stage: "parse", done: 4, total: 8 } },
            { type: "index-progress", id: 3, progress: { stage: "parse", done: 8, total: 8 } },
            { type: "indexed", id: 3, outcome: { ok: true, result: { files: 8, changed: 1, deleted: 1, edges: 11, folders: 6, levelEdges: 10, errors: [], skipped: 0, totalMs: 12 } } },
        ]);
    });

    it("points the service at a new repo, then says it's ready", async () => {
        const roots: (string | null)[] = [];
        const sent: ChildMessage[] = [];
        await handleParentMessage(fakeService({ setRepo: async (r) => { roots.push(r); } }), { type: "repo", root: "/r" }, (m) => sent.push(m));
        expect(roots).toEqual(["/r"]);
        expect(sent).toEqual([{ type: "ready" }]);
    });
});
