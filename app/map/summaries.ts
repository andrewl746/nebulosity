import type { DescribeResponse, ErrorCode, SummaryStatus } from "@/lib/contracts";

/** A "summarize now" answer that isn't a summary: the error's code and its sentence (ApiError has both). */
type SummaryAnswer = { code: ErrorCode | "NETWORK"; message: string };

/**
 * Answers that say the summary waits on something, not that an attempt failed: retrying can't help until it changes.
 * NOT_READY waits on the folder's insides; SUMMARIES_OFF here means the repo's summaries were never confirmed (with no
 * key the panel never asks, ADR-038 amended).
 */
const WAITING: ReadonlySet<string> = new Set(["NOT_READY", "SUMMARIES_OFF"]);

const missingOrOutOfDate = (status: SummaryStatus): boolean => status === "pending" || status === "stale";

/**
 * Whether opening a target should ask for its summary now (PIVOT_SPEC.md §5.3). It's missing or out of date, or a model
 * wrote it with an older version of the prompt, which opening rewrites in the current style (Q2 B). While summaries are
 * off that one isn't asked for, since the answer could only be SUMMARIES_OFF (P11). "off" never asks.
 */
export function wantsSummary(target: Pick<DescribeResponse, "summaryStatus" | "summaryOlderStyle">, summariesOff: boolean): boolean {
    return missingOrOutOfDate(target.summaryStatus) || (target.summaryOlderStyle === true && !summariesOff);
}

/**
 * What the panel remembers having asked for. A missing or out-of-date summary is asked for once per index version, as
 * the index moving can mean it changed again. One that's only in the older style is asked for once per panel. A rewrite
 * that fails leaves it current in the older style and moves the index (the stage refresh after it), so asking at each
 * version would send again and again for as long as the panel stays open.
 */
export function askKey(target: Pick<DescribeResponse, "path" | "indexVersion" | "summaryStatus">): string {
    return missingOrOutOfDate(target.summaryStatus) ? `${target.path}@${target.indexVersion}` : `${target.path}@older`;
}

/** What's on show in the panel: the description, or the "summarize now" answer that replaced it. */
type ShownSummary = { tagline?: string; summary?: string; summaryStatus: SummaryStatus; summaryOlderStyle?: true };

/**
 * The quiet lines under a summary. "Refreshing…" while it's rewritten. "Out of date, it changed since it was
 * summarized." when its input changed, except for a folder or the repo an older prompt wrote, which reads stale once a
 * child is restyled though no code changed (P10). Nothing for the older style itself (Q1 A). testsNote is the import-count
 * note, which belongs to a file's older summary only, since the current prompt gives no counts.
 */
export function summaryNotes(shown: ShownSummary, kind: DescribeResponse["kind"], refreshing: boolean): { notes: string[]; testsNote: boolean } {
    const olderFolder = kind !== "file" && shown.summaryOlderStyle === true;
    const notes = [
        refreshing && shown.tagline ? "Refreshing…" : "",
        shown.summaryStatus === "stale" && !refreshing && !olderFolder ? "Out of date, it changed since it was summarized." : "",
    ].filter(Boolean);
    // an older summary was written from an "Imported by" line that counts tests apart, and "Used by" counts them
    const testsNote = Boolean(shown.summary) && kind === "file" && shown.summaryOlderStyle === true;
    return { notes, testsNote };
}

/** What the panel says in place of a summary it doesn't have. */
export function placeholderFor(status: SummaryStatus): string {
    switch (status){
        case "off": return "Summaries are off, since ANTHROPIC_API_KEY isn't set. With a key, each file and folder gets a short plain-language summary here, and search can match by meaning.";
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
