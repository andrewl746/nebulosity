"use client";

import { useEffect, useState } from "react";
import type { LiveEvent } from "@/lib/contracts";
import { activityLabel, activityTitle, highlightedNote } from "./activity";
import { ago } from "./format";
import { DEMO } from "./mode";

/** Where each older action leaves a narrowing bar: the second under 640 px, the third under 900 (the newest stays). */
const OLDER_STEPS: readonly string[] = ["", "max-[639px]:hidden", "max-[899px]:hidden"];

/**
 * The activity bar (VISUAL_REFRESH.md §6): a slim strip along the bottom, always there, with Claude Code's last 3
 * actions, newest first, each with an orange dot. Live activity is the demo's differentiator, so it's never hidden;
 * it stays slim so the Map remains the focus. E1 adds the Guide's input beside it. While show_on_map has highlighted
 * something, its right end says how many and offers Clear (Esc does the same once nothing is selected).
 *
 * In a narrow window (VISUAL_REFRESH.md, "Narrow windows") the older actions go first: 2 under 900 px, the newest alone
 * under 640, and under 520 its time and the "Claude Code" word go too (the dot's title keeps the word). Each action
 * truncates, whole in its title. The highlights' count and Clear always stay.
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
        <footer data-testid="activity-bar" className="relative z-20 flex h-8 shrink-0 items-center gap-4 border-t border-hairline bg-panel px-4 text-[13px]">
            <span className="flex shrink-0 items-center gap-2 text-text-2" title={connected ? "Claude Code: connected to the live channel" : "Claude Code: not connected to the live channel"}>
                <span aria-hidden className={`h-2 w-2 rounded-full ${connected ? "bg-text-2" : "border border-text-2"}`} />
                <span className={recent.length > 0 ? "max-[519px]:hidden" : undefined}>Claude Code</span>
            </span>
            {recent.length === 0
                ? <span className="min-w-0 truncate text-text-2" title={empty}>{empty}</span>
                : (
                    <ol aria-label="Claude Code's last actions" className="flex min-w-0 flex-1 items-center gap-6">
                        {recent.map((event, i) => (
                            <li key={`${event.at}\0${i}`} className={`flex min-w-0 items-center gap-2 ${OLDER_STEPS[i] ?? ""}`}>
                                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-agent" />
                                <span className={`truncate ${i === 0 ? "text-text" : "text-text-2"}`} title={activityTitle(event)}>{activityLabel(event)}</span>
                                {now > 0 && <span className="shrink-0 text-[12px] text-text-2 max-[519px]:hidden">{ago(Math.max(0, now - Date.parse(event.at)))}</span>}
                            </li>
                        ))}
                    </ol>
                )}
            {highlightNote !== null && (
                <span className="ml-auto flex shrink-0 items-center gap-3 text-text-2">
                    {highlightNote}
                    <button type="button" onClick={onClear} className="text-control hover:underline" title="Clear Claude Code's highlights (Esc)">Clear</button>
                </span>
            )}
        </footer>
    );
}
