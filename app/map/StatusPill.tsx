"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { IndexStatus, StageName } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { formatCount, headline, stageLabel, type Tone } from "./format";
import { DEMO } from "./mode";
import { placePopover, usePlaceOnResize } from "./popover";
import { useDismiss } from "./useDismiss";

/** The status menu's width, at normal sizes (narrower only when the Map is). */
const MENU_WIDTH = 340;

/** Green means indexed and nothing else (VISUAL_REFRESH.md §2); a failure, or nothing indexed, is the error color. No motion. */
const DOTS: Record<Tone, string> = {
    ok: "bg-ok",
    busy: "bg-text-2",
    warn: "bg-danger",
    off: "bg-text-2",
};

const STAGES: readonly StageName[] = ["structure", "summaries", "embeddings"];

/**
 * The index status (VISUAL_REFRESH.md §6: a status dot on the right of the top bar): the stage that most needs
 * attention, in one line. Opening it lists every stage with its counts and note, and offers a re-index
 * (POST /api/index) with its progress. The static demo's index is frozen, so there it says so instead (ADR-049).
 */
export default function StatusPill({ status }: { status: IndexStatus | null }){
    const [open, setOpen] = useState(false);
    const [reindex, setReindex] = useState<string | null>(null);
    // where the menu opens, worked out as it opens and as the window resizes: right under the pill, kept inside a narrow
    // Map (popover.ts)
    const [menuPlace, setMenuPlace] = useState<CSSProperties>({ right: 0, width: MENU_WIDTH });
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
    const place = useCallback(() => {
        if (ref.current) setMenuPlace(placePopover(ref.current, MENU_WIDTH, "end"));
    }, [ref]);
    usePlaceOnResize(open, place);
    if (status === null) return null;
    const head = headline(status);
    const toggle = (): void => {
        if (!open) place();
        setOpen((o) => !o);
    };

    const runReindex = (): void => {
        setReindex("starting…");
        api.reindex((p) => setReindex(`${p.stage} ${formatCount(p.done)} / ${formatCount(p.total)}`)).then(
            (done) => setReindex(`re-indexed ${formatCount(done.files)} files in ${(done.totalMs / 1000).toFixed(1)} s`),
            (err: unknown) => setReindex(err instanceof ApiError ? err.message : "the re-index failed"),
        );
    };

    // a narrow window keeps the dot alone (TopBar's steps), and a squeezed pill truncates its words: the title has them
    return (
        <div ref={ref} className="relative min-w-0">
            <button
                type="button"
                data-testid="status-pill"
                onClick={toggle}
                aria-expanded={open}
                title={`${head.text} · ${DEMO ? "Index status: what's indexed" : "Index status: what's indexed, and re-index"}`}
                className="flex max-w-full items-center gap-2 rounded-md border border-border px-2.5 py-1 text-[12px] text-text-2 hover:border-text-2 hover:text-text"
            >
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOTS[head.tone]}`} />
                <span className="truncate max-[520px]:hidden">{head.text}</span>
                <IconChevronDown aria-hidden size={14} stroke={1.75} className={`shrink-0 ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <div data-testid="status-menu" data-covers style={menuPlace} className="absolute top-9 z-30 space-y-3 overflow-y-auto rounded-lg border border-border bg-node p-3 text-[12px] text-text-2">
                    {STAGES.map((name) => (
                        <div key={name}>
                            <div className="text-[13px] text-text">{stageLabel(name, status.stages[name])}</div>
                            {status.stages[name].note && <div>{status.stages[name].note}</div>}
                        </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-divider pt-3">
                        {DEMO
                            ? <span>A static demo: the index is frozen at export.</span>
                            : (
                                <>
                                    <span className="truncate" title={reindex ?? `index version ${status.indexVersion}`}>{reindex ?? `index version ${status.indexVersion}`}</span>
                                    <button type="button" onClick={runReindex} className="shrink-0 text-[13px] text-text underline underline-offset-2 hover:text-text">Re-index</button>
                                </>
                            )}
                    </div>
                </div>
            )}
        </div>
    );
}
