import type { SummaryStatus } from "@/lib/contracts";

/** Whether opening a target should ask for its summary now (PIVOT_SPEC.md §5.3): it's missing or out of date. "off" never asks. */
export function wantsSummary(status: SummaryStatus): boolean {
    return status === "pending" || status === "stale";
}

/** What the panel says in place of a summary it doesn't have. */
export function placeholderFor(status: SummaryStatus): string {
    switch (status){
        case "off": return "Summaries are off: ANTHROPIC_API_KEY isn't set.";
        case "failed": return "The last attempt to summarize this failed.";
        case "pending": return "Summarizing…";
        default: return "";
    }
}
