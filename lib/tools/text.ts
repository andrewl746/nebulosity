import type { SummaryStatus } from "../contracts";
import { freshnessNote } from "../engine/freshness";
import { joinParagraphs } from "../index/summarize/prompts";

/**
 * Answers stay under this many characters (ADR-047). Claude Code warns past 10,000 tokens and moves a text result of
 * 50,000 characters or more into a file the model has to read back.
 */
export const MAX_ANSWER_CHARS = 40_000;

/** Free mode's line where a summary would go (ADR-043): it says what an API key adds. */
export const SUMMARIES_OFF_LINE = "Summary: none — summaries are off (no ANTHROPIC_API_KEY); a key adds a short summary of every file and folder.";

/** A path as answers write it: folders end in "/", so a reader tells them from files. */
export function shownPath(repoPath: string, kind: "folder" | "file"): string {
    return kind === "folder" ? `${repoPath}/` : repoPath;
}

/** A count as answers write it: 4231 → "4,231". */
export const formatCount = (n: number): string => n.toLocaleString("en-US");

/** The line where a summary goes: its text, its paragraphs joined by a space so it stays one line, or what's in its place. */
export function summaryLine(target: { tagline?: string; summary?: string; summaryStatus: SummaryStatus; summaryError?: string }): string {
    if (target.tagline){
        const text = target.summary ? `${target.tagline} — ${joinParagraphs(target.summary)}` : target.tagline;
        return target.summaryStatus === "stale" ? `${text} (Out of date: changed since it was summarized.)` : text;
    }
    if (target.summaryStatus === "off") return SUMMARIES_OFF_LINE;
    if (target.summaryStatus === "failed") return `Summary: failed${target.summaryError ? ` (${target.summaryError})` : ""}.`;
    return "Summary: not written yet.";
}

/** How many of `lines` to show: at most `limit`, and only as many as fit in `budget` characters, one per line. */
export function fitting(lines: readonly string[], limit: number, budget: number): number {
    let used = 0;
    let count = 0;
    while (count < lines.length && count < limit && used + lines[count].length + 1 <= budget){
        used += lines[count].length + 1;
        count++;
    }
    return count;
}

/** "… 4,231 more", and where the next page starts when the list pages. */
export function moreLine(hidden: number, nextOffset?: number): string {
    return `… ${formatCount(hidden)} more${nextOffset === undefined ? "" : ` (next page: offset ${nextOffset})`}`;
}

/** What a tool's answer is made of, before the call's own notes are added. */
export type AnswerParts = { body: string[]; notes?: string[]; stale?: number };

/**
 * An answer's text (PIVOT_SPEC.md §6.2, ADR-047): the repo note first, because everything after it is about that repo;
 * then the body; then the tool's notes, the index note, and the stale-summary note last.
 */
export function answerText(parts: AnswerParts & { repoNote?: string; indexNote?: string }): string {
    const stale = parts.stale ? freshnessNote(parts.stale) : null;
    const note = (text: string): string => `Note: ${text}`;
    return [
        ...(parts.repoNote ? [note(parts.repoNote)] : []),
        ...parts.body,
        ...(parts.notes ?? []).map(note),
        ...(parts.indexNote ? [note(parts.indexNote)] : []),
        ...(stale ? [note(stale)] : []),
    ].join("\n");
}

/** What became of a show_on_map event (decided by the adapter, ADR-046). */
export type MapDelivery = "shown" | "no-map" | "live-off" | "other-repo";

/** The sentence a show_on_map answer ends with. `mapRepo` and `repo` are names, not roots. */
export function deliveryNote(delivery: MapDelivery, where: { port: number; mapRepo: string | null; repo: string }): string {
    switch (delivery){
        case "shown": return `Sent to the Map at http://localhost:${where.port}; any open Map tab shows it.`;
        case "no-map": return `No Map answered at http://localhost:${where.port}, so nothing is shown. The user can start it with nebulosity map (in a checkout of Nebulosity: npm run dev).`;
        case "live-off": return "Nothing was sent: live updates are off in this session (NEBULOSITY_LIVE=off).";
        case "other-repo": return `Nothing was sent: the Map shows ${where.mapRepo ?? "no repository"}, not ${where.repo}. The user can pick ${where.repo} in the Map's repo menu.`;
    }
}
