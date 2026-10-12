"use client";

import { useState } from "react";
import type { IndexStatus, StageName } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { formatCount, headline, stageLabel, type Tone } from "./format";
import { useDismiss } from "./useDismiss";

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
 * (POST /api/index) with its progress.
 */
export default function StatusPill({ status }: { status: IndexStatus | null }){
    const [open, setOpen] = useState(false);
    const [reindex, setReindex] = useState<string | null>(null);
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
    if (status === null) return null;
    const head = headline(status);

    const runReindex = (): void => {
        setReindex("starting…");
        api.reindex((p) => setReindex(`${p.stage} ${formatCount(p.done)} / ${formatCount(p.total)}`)).then(
            (done) => setReindex(`re-indexed ${formatCount(done.files)} files in ${(done.totalMs / 1000).toFixed(1)} s`),
            (err: unknown) => setReindex(err instanceof ApiError ? err.message : "the re-index failed"),
        );
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                data-testid="status-pill"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-text-2 hover:bg-surface hover:text-text"
            >
                <span aria-hidden className={`h-2 w-2 rounded-full ${DOTS[head.tone]}`} />
                {head.text}
            </button>
            {open && (
                <div data-testid="status-menu" className="absolute right-0 top-9 z-30 w-[340px] space-y-3 rounded-lg border border-border bg-surface p-3 text-[12px] text-text-2">
                    {STAGES.map((name) => (
                        <div key={name}>
                            <div className="text-[13px] text-text">{stageLabel(name, status.stages[name])}</div>
                            {status.stages[name].note && <div>{status.stages[name].note}</div>}
                        </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
                        <span className="truncate">{reindex ?? `index version ${status.indexVersion}`}</span>
                        <button type="button" onClick={runReindex} className="shrink-0 text-[13px] text-text underline underline-offset-2 hover:text-text-2">Re-index</button>
                    </div>
                </div>
            )}
        </div>
    );
}
