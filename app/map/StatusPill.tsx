"use client";

import { useState } from "react";
import type { IndexStatus, StageName } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { formatCount, headline, stageLabel, type Tone } from "./format";

const DOTS: Record<Tone, string> = {
    ok: "bg-green-300/80",
    busy: "animate-pulse bg-cyan-300/80",
    warn: "bg-amber-300/80",
    off: "bg-zinc-500",
};

const STAGES: readonly StageName[] = ["structure", "summaries", "embeddings"];

/**
 * The index-status pill (PIVOT_SPEC.md §7): the stage that most needs attention, in one line. Opening it lists every
 * stage with its counts and note, and offers a re-index (POST /api/index) with its progress.
 */
export default function StatusPill({ status }: { status: IndexStatus | null }){
    const [open, setOpen] = useState(false);
    const [reindex, setReindex] = useState<string | null>(null);
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
        <div className="relative">
            <button
                type="button"
                data-testid="status-pill"
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 rounded-full border border-purple-400/20 bg-black/40 px-2.5 py-0.5 font-mono text-[10.5px] text-zinc-300 hover:border-purple-300/40"
            >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOTS[head.tone]}`} />
                {head.text}
            </button>
            {open && (
                <div className="absolute right-0 top-8 z-30 w-[340px] space-y-2 rounded-sm border border-purple-400/25 bg-[#0c0716]/95 p-3 font-mono text-[10.5px] text-zinc-400 shadow-[0_0_30px_rgba(126,58,242,0.2)]">
                    {STAGES.map((name) => (
                        <div key={name}>
                            <div className="text-zinc-200">{stageLabel(name, status.stages[name])}</div>
                            {status.stages[name].note && <div className="text-zinc-500">{status.stages[name].note}</div>}
                        </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-purple-400/15 pt-2">
                        <span className="truncate text-zinc-500">{reindex ?? `index version ${status.indexVersion}`}</span>
                        <button type="button" onClick={runReindex} className="shrink-0 text-purple-300/80 hover:text-purple-200">Re-index</button>
                    </div>
                </div>
            )}
        </div>
    );
}
