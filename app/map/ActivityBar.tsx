"use client";

import { useEffect, useState } from "react";
import type { LiveEvent } from "@/lib/contracts";
import { activityLabel, activityTitle, highlightedNote, newestTitle } from "./activity";
import { ago } from "./format";
import { DEMO } from "./mode";

/** Where each older action leaves a narrowing bar: the second under 640 px, the third under 900 (the newest stays). */
const OLDER_STEPS: readonly string[] = ["", "max-[640px]:hidden", "max-[900px]:hidden"];
/**
 * Under 900 px the newest action takes the room it needs, and the older one only what's left (a container, so as that
 * runs out its time goes, then the rest of it, rather than squeezing to a sliver). At 900 and up they share the bar as
 * they always have.
 */
const OLDER_ROOM = "max-[900px]:@container max-[900px]:basis-0 max-[900px]:grow";
/** What an older action keeps in what's left: its time under 136 px, nothing under 64 (the dot and a few letters). */
const OLDER_TIME = "@max-[136px]:hidden";
const OLDER_REST = "@max-[64px]:hidden";

/**
 * The activity bar (VISUAL_REFRESH.md §6): a slim strip along the bottom, always there, with Claude Code's last 3
 * actions, newest first, each with an orange dot. Live activity is the demo's differentiator, so it's never hidden;
 * it stays slim so the Map remains the focus. E1 adds the Guide's input beside it. While show_on_map has highlighted
 * something, its right end says how many and offers Clear (Esc does the same once nothing is selected).
 *
 * In a narrow window (VISUAL_REFRESH.md, "Narrow windows") the older actions go first: 2 under 900 px, the newest
 * keeping the room it needs and the older one what's left, the newest alone under 640, and under 520 its time and the
 * "Claude Code" word go too (the dot's title keeps the word). Each action truncates, whole in its title, and the
 * newest's title lists the older ones with their times. The highlights' count and Clear always stay.
 */
export default function ActivityBar({ recent, connected, highlightCount, onClear }: {
    recent: readonly LiveEvent[];
    connected: boolean;
    /** How many places show_on_map has highlighted. */
    highlightCount: number;
    onClear: () => void;
}){
    // the clock lives in state, ticking every second: reading Date.now() during render isn't allowed
    const [now, setNow] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, []);

    const highlightNote = highlightedNote(highlightCount);

    // the static demo never connects: say why the bar is empty, instead of "Not connected" (ADR-049)
    const empty = DEMO
        ? "In the app, Claude Code's tool calls show up here as it works. This static demo has no live channel."
        : connected ? "No tool calls yet" : "Not connected";

    return (
        <footer data-testid="activity-bar" className="relative z-20 flex h-8 shrink-0 items-center gap-4 border-t border-divider bg-panel px-4 text-[13px]">
            <span className="flex shrink-0 items-center gap-2 text-text-2" title={connected ? "Claude Code: connected to the live channel" : "Claude Code: not connected to the live channel"}>
                <span aria-hidden className={`h-2 w-2 rounded-full ${connected ? "bg-text-2" : "border border-text-2"}`} />
                <span className={recent.length > 0 ? "max-[520px]:hidden" : undefined}>Claude Code</span>
            </span>
            {recent.length === 0
                ? <span className="min-w-0 truncate text-text-2" title={empty}>{empty}</span>
                : (
                    <ol aria-label="Claude Code's last actions" className="flex min-w-0 flex-1 items-center gap-6">
                        {recent.map((event, i) => (
                            <li key={`${event.at}\0${i}`} className={`flex min-w-0 items-center gap-2 ${OLDER_STEPS[i] ?? ""} ${i > 0 ? OLDER_ROOM : ""}`}>
                                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full bg-agent ${i > 0 ? OLDER_REST : ""}`} />
                                {/* the newest's title also holds what a narrow bar drops: the older actions and the times */}
                                <span className={`truncate ${i === 0 ? "text-text" : `text-text-2 ${OLDER_REST}`}`} title={i === 0 ? newestTitle(recent, now) : activityTitle(event)}>{activityLabel(event)}</span>
                                {now > 0 && <span className={`shrink-0 text-[12px] text-text-2 max-[520px]:hidden ${i > 0 ? OLDER_TIME : ""}`}>{ago(Math.max(0, now - Date.parse(event.at)))}</span>}
                            </li>
                        ))}
                    </ol>
                )}
            {highlightNote !== null && (
                <span className="ml-auto flex shrink-0 items-center gap-3 text-text-2">
                    {highlightNote}
                    <button type="button" onClick={onClear} className="text-text hover:underline" title="Clear Claude Code's highlights (Esc)">Clear</button>
                </span>
            )}
        </footer>
    );
}
