"use client";

import { useEffect, useState } from "react";
import type { LiveEvent } from "@/lib/contracts";
import { ago } from "./format";

/** After this long without a tool call, the pill reads idle. */
const IDLE_AFTER_MS = 30_000;

/** The bottom dock (PIVOT_SPEC.md §7): v1's live Claude Code pill. E1 adds the Guide's input beside it. */
export default function LiveDock({ last, connected }: { last: LiveEvent | null; connected: boolean }){
    // the clock lives in state, ticking every second: reading Date.now() during render isn't allowed
    const [now, setNow] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, []);

    const age = last !== null && now > 0 ? now - Date.parse(last.at) : Infinity;
    const active = last !== null && age < IDLE_AFTER_MS;
    const dot = !connected ? "bg-zinc-600" : active ? "animate-pulse bg-cyan-300" : "bg-cyan-300/40";

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
            <div data-testid="live-dock" className="pointer-events-auto flex max-w-[560px] items-center gap-2 rounded-full border border-purple-400/25 bg-[#0c0716]/85 px-3 py-1 font-mono text-[10.5px] text-zinc-400 backdrop-blur-xl">
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                <span className="text-zinc-300">Claude Code</span>
                <span aria-hidden className="text-zinc-600">·</span>
                {active && last
                    ? (
                        <span className="truncate">
                            {last.tool} · {last.paths[0] || "the repo"}{last.paths.length > 1 ? ` +${last.paths.length - 1}` : ""} · {ago(age)}
                        </span>
                    )
                    : <span>{connected ? "idle" : "not connected"}</span>}
            </div>
        </div>
    );
}
