import type { SummaryText } from "../../lib/db/store/summaries";
import type { Summarizer, SummaryOutcome, SummaryRequest } from "../../lib/index/summarize/types";

export type StubOptions = {
    /** Fixed texts by target path ("" is the repo). Everything else gets "About <subject>". */
    texts?: Record<string, SummaryText>;
    /** Target paths whose requests fail. */
    failPaths?: string[];
    /** How many polls a batch answers null before its results are ready. */
    pollsBeforeDone?: number;
    /** How many polls, counting every batch, throw "Connection error." before polling works normally. A failed poll still counts as a poll. */
    failPolls?: number;
};

/**
 * Batches are numbered across every stub in a test file, not per stub: like Anthropic's, a
 * batch id must name one batch only. Two stubs both handing out "batch-1" would let one
 * repo's run collect another repo's rows (batch rows are looked up by id alone).
 */
let batchesMade = 0;

/**
 * Stands in for Claude in tests (PIVOT_SPEC.md §11: tests make no network calls). It
 * answers from the prompt's first line ("File: src/a.ts", "Folder: src", "Repository:
 * mini-repo") and numbers each summary, so a redone summary always reads differently.
 */
export function stubSummarizer(options: StubOptions = {}){
    const requests: SummaryRequest[] = [];
    const batches = new Map<string, { requests: SummaryRequest[]; polls: number }>();
    let written = 0;
    let failedPolls = 0;

    const answer = (request: SummaryRequest): SummaryOutcome => {
        const subject = request.prompt.split("\n")[0];
        const target = subject.startsWith("Repository: ") ? "" : subject.slice(subject.indexOf(": ") + 2);

        if (options.failPaths?.includes(target)){
            return { customId: request.customId, ok: false, error: "stub failure", model: request.model, usage: [{ model: request.model, inputTokens: 10, outputTokens: 0 }] };
        }

        written++;
        const text = options.texts?.[target] ?? { tagline: `About ${subject}`, summary: `Summary ${written} for ${subject}.` };
        return { customId: request.customId, ok: true, text, model: request.model, usage: [{ model: request.model, inputTokens: 100, outputTokens: 20 }] };
    };

    const summarizer: Summarizer = {
        async summarize(request){
            requests.push(request);
            return answer(request);
        },
        async submitBatch(batch){
            batchesMade++;
            const id = `stub-batch-${batchesMade}`;
            requests.push(...batch);
            batches.set(id, { requests: [...batch], polls: 0 });
            return id;
        },
        async batchResults(id){
            const batch = batches.get(id);
            if (!batch) throw new Error(`no batch ${id}`);
            batch.polls++;
            if (failedPolls < (options.failPolls ?? 0)){
                failedPolls++;
                throw new Error("Connection error.");
            }
            return batch.polls > (options.pollsBeforeDone ?? 0) ? batch.requests.map(answer) : null;
        },
    };

    return { summarizer, requests, batches, subjects: () => requests.map((r) => r.prompt.split("\n")[0]) };
}
