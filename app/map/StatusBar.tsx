"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { IndexStatus, LiveEvent, StageName } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { activityLabel, highlightedNote, newestTitle } from "./activity";
import { ago, formatCount, headline, stageLabel, type Tone } from "./format";
import { DEMO } from "./mode";
import { placePopover, usePlaceOnResize } from "./popover";
import { useDismiss } from "./useDismiss";

type StatusBarProps = {
    status: IndexStatus | null;
    recent: readonly LiveEvent[];
    connected: boolean;
    /** How many places show_on_map has highlighted, which Clear lets go of (Esc too). */
    highlightCount: number;
    onClear: () => void;
    /** The boxes on screen and the lines Strong links only hides, for the counts on the right. */
    items: number;
    weakHidden: number;
    /** VS Code's slim form: only what VS Code's own bar lacks (the owner's pick, 2026-10-27). */
    embedded: boolean;
    /** A very short window: only the two dots, at the header's end (shell.ts). */
    dots: boolean;
};

/** The indexed dot means indexed and nothing else; a failure or nothing indexed is the error color. */
const DOTS: Record<Tone, string> = { ok: "bg-ok", busy: "bg-text-3", warn: "bg-danger", off: "bg-text-3" };
const STAGES: readonly StageName[] = ["structure", "summaries", "embeddings"];
/** The index menu's width at normal sizes, narrower only when the window is. */
const MENU_WIDTH = 340;

/**
 * The status bar along the Map's bottom (the Workbench redesign, ADR-070), 24 px. Left: the index status with its dot
 * (it opens the stages and Re-index), the repo's file count, and Claude Code's newest action as it works, with its
 * orange dot; with show_on_map highlights up, how many and Clear. Right: the items on screen and the lines Strong links
 * only hides, and the search shortcut. Inside VS Code's panel it's the slim form the owner picked: the index and Claude
 * Code cells and the counts, VS Code's own bar having the rest.
 *
 * As the window narrows the cells give way in order, the shortcut under 1100 px, the counts under 800, the file count
 * under 560, and the cells' words under 420, so the two dots, index and Claude Code, always stay (their titles say the
 * rest). In a very short window the bar goes and the two dots move to the header's end.
 */
export default function StatusBar({ status, recent, connected, highlightCount, onClear, items, weakHidden, embedded, dots }: StatusBarProps){
    // the clock lives in state, ticking every second: reading Date.now() during render isn't allowed
    const [now, setNow] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, []);
    const newest = recent[0];
    const live = newest !== undefined
        ? { text: activityLabel(newest), title: newestTitle(recent, now), active: true }
        : {
            // the static demo never connects: say why the cell is quiet, instead of "Not connected" (ADR-049)
            text: DEMO ? "Static demo, no live Claude Code channel" : connected ? "Claude Code, no tool calls yet" : "Claude Code isn't connected",
            title: DEMO ? "In the app, Claude Code's tool calls show up here as it works. This static demo has no live channel." : connected ? "Claude Code is connected to the live channel" : "Claude Code isn't connected to the live channel",
            active: false,
        };
    const liveDot = <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${live.active ? "bg-agent" : connected ? "bg-text-3" : "border border-text-3"}`} />;

    if (dots){
        return (
            <span className="flex shrink-0 items-center gap-2.5 pl-1">
                <IndexCell status={status} compact />
                <span title={`${live.text}. ${live.title}`} className="grid h-6 w-4 place-items-center">{liveDot}</span>
            </span>
        );
    }

    const highlights = highlightedNote(highlightCount);
    return (
        <footer data-testid="activity-bar" className="relative z-20 flex h-6 shrink-0 items-center gap-4 border-t border-divider bg-panel px-3 text-[11.5px] text-text-3">
            <IndexCell status={status} compact={false} />
            {!embedded && status !== null && (
                <span className="shrink-0 whitespace-nowrap max-[560px]:hidden">{formatCount(status.stages.structure.total)} files</span>
            )}
            <span className="flex min-w-0 items-center gap-1.5" title={live.title}>
                {liveDot}
                <span className={`truncate max-[420px]:hidden ${live.active ? "text-text-2" : ""}`}>{live.text}</span>
                {live.active && now > 0 && <span className="shrink-0 max-[800px]:hidden">{ago(Math.max(0, now - Date.parse(newest!.at)))}</span>}
            </span>
            {highlights !== null && (
                <span className="flex shrink-0 items-center gap-2">
                    <span className="max-[640px]:hidden">{highlights}</span>
                    <button type="button" onClick={onClear} title="Clear Claude Code's highlights (Esc)" className="text-text-2 underline decoration-text-3 underline-offset-2 hover:text-text">Clear</button>
                </span>
            )}
            <span className="ml-auto shrink-0 whitespace-nowrap max-[800px]:hidden">
                {formatCount(items)} {items === 1 ? "item" : "items"}{weakHidden > 0 ? `, ${formatCount(weakHidden)} weak ${weakHidden === 1 ? "link" : "links"} hidden` : ""}
            </span>
            {!embedded && <span className="shrink-0 whitespace-nowrap max-[1100px]:hidden">Ctrl K to search</span>}
        </footer>
    );
}

/**
 * The index status: its dot and, but in the compact form, the stage that most needs attention in a few words. It
 * opens the stages with their counts and Re-index (POST /api/index) with its progress, upward from the bar and kept
 * inside the window. The static demo's index is frozen, so there it says so instead (ADR-049).
 */
function IndexCell({ status, compact }: { status: IndexStatus | null; compact: boolean }){
    const [open, setOpen] = useState(false);
    const [reindex, setReindex] = useState<string | null>(null);
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
    // at the header's end (a very short window) it opens downward, placed inside the window as it opens and as the
    // window resizes, like the header's other popovers (popover.ts); in the bar it opens upward from the bar's start
    const [place, setPlace] = useState<CSSProperties>({ right: 0, width: MENU_WIDTH });
    const placeMenu = useCallback(() => {
        if (ref.current) setPlace(placePopover(ref.current, MENU_WIDTH, "end"));
    }, [ref]);
    usePlaceOnResize(open && compact, placeMenu);
    if (status === null) return null;
    const head = headline(status);
    const runReindex = (): void => {
        setReindex("Starting…");
        api.reindex((p) => setReindex(`${p.stage} ${formatCount(p.done)} / ${formatCount(p.total)}`)).then(
            (done) => setReindex(`Re-indexed ${formatCount(done.files)} files in ${(done.totalMs / 1000).toFixed(1)} s`),
            (err: unknown) => setReindex(err instanceof ApiError ? err.message : "The re-index failed"),
        );
    };
    return (
        <div ref={ref} className="relative flex min-w-0 shrink-0 items-center">
            <button
                type="button"
                data-testid="status-pill"
                onClick={() => {
                    if (!open && compact) placeMenu();
                    setOpen((o) => !o);
                }}
                aria-expanded={open}
                title={`${head.text}. ${DEMO ? "The index status" : "The index status, and Re-index"}`}
                className="flex min-w-0 items-center gap-1.5 rounded-[4px] px-0.5 hover:text-text"
            >
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[head.tone]}`} />
                {!compact && <span className="truncate max-[420px]:hidden">{head.text}</span>}
            </button>
            {open && (
                <div
                    data-testid="status-menu"
                    data-covers
                    style={compact ? place : { width: `min(${MENU_WIDTH}px, calc(100vw - 24px))`, maxHeight: "calc(100vh - 80px)" }}
                    className={`absolute z-30 space-y-3 overflow-y-auto rounded-md border border-border bg-panel p-3 text-[12px] text-text-2 ${compact ? "top-7" : "bottom-6 left-0"}`}
                >
                    {STAGES.map((name) => (
                        <div key={name}>
                            <div className="text-[13px] text-text">{stageLabel(name, status.stages[name])}</div>
                            {status.stages[name].note && <div>{status.stages[name].note}</div>}
                        </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-divider pt-3">
                        {DEMO
                            ? <span>A static demo, its index frozen when it was exported.</span>
                            : (
                                <>
                                    <span className="truncate" title={reindex ?? `Index version ${status.indexVersion}`}>{reindex ?? `Index version ${status.indexVersion}`}</span>
                                    <button type="button" onClick={runReindex} className="shrink-0 rounded-[5px] border border-border px-2 py-0.5 text-[12.5px] text-text hover:border-text-3">Re-index</button>
                                </>
                            )}
                    </div>
                </div>
            )}
        </div>
    );
}
