import type { ErrorCode, SummaryStatus } from "@/lib/contracts";

/** A "summarize now" answer that isn't a summary: the error's code and its sentence (ApiError has both). */
type SummaryAnswer = { code: ErrorCode | "NETWORK"; message: string };

/**
 * Answers that say the summary waits on something, not that an attempt failed: retrying can't help until it changes.
 * NOT_READY waits on the folder's insides; SUMMARIES_OFF here means the repo's summaries were never confirmed (with no
 * key the panel never asks, ADR-038 amended).
 */
const WAITING: ReadonlySet<string> = new Set(["NOT_READY", "SUMMARIES_OFF"]);

/** Whether opening a target should ask for its summary now (PIVOT_SPEC.md §5.3): it's missing or out of date. "off" never asks. */
export function wantsSummary(status: SummaryStatus): boolean {
    return status === "pending" || status === "stale";
}

/** What the panel says in place of a summary it doesn't have. */
export function placeholderFor(status: SummaryStatus): string {
    switch (status){
        case "off": return "Summaries are off: ANTHROPIC_API_KEY isn't set. With a key, each file and folder gets a short plain-language summary here, and search can match by meaning.";
        case "failed": return "The last attempt to summarize this failed.";
        case "pending": return "Summarizing…";
        default: return "";
    }
}

/** The plain line in place of a missing summary, given the last "summarize now" answer: what it waits on, else placeholderFor. */
export function summaryLine(status: SummaryStatus, answer: SummaryAnswer | null): string {
    if (answer?.code === "NOT_READY") return "Waiting for what's inside to be summarized first.";
    if (answer?.code === "SUMMARIES_OFF") return answer.message;   // "run nebulosity summarize …, which shows the estimate"
    return placeholderFor(status);
}

/** The failure the panel shows in red with "Try again": the stored one, else an answer that isn't a wait. */
export function failureFor(storedError: string | undefined, answer: SummaryAnswer | null): string | null {
    return storedError ?? (answer && !WAITING.has(answer.code) ? answer.message : null);
}
