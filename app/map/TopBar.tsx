"use client";

import { useSyncExternalStore, type ReactNode } from "react";

type TopBarProps = {
    /** The repo's name, or the repo picker (Task 20). */
    repo: ReactNode;
    /** Opens ⌘K search (Task 19). The button appears once it's passed. */
    onSearch?: () => void;
    /** The index-status pill (Task 20). */
    status?: ReactNode;
};

const noSubscription = () => () => {};

/** The top bar (PIVOT_SPEC.md §7): the repo, the search palette's button, and a lens switcher showing the lenses that exist. */
export default function TopBar({ repo, onSearch, status }: TopBarProps){
    // the server renders "Ctrl K"; a Mac shows "⌘K" once hydrated, without a mismatch
    const isMac = useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);

    return (
        <header className="pointer-events-auto relative z-20 flex h-11 items-center gap-4 border-b border-purple-500/15 bg-[#06070B]/70 px-4 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cyan-300/80" />
                {repo}
            </div>
            <div className="flex flex-1 justify-center">
                {onSearch && (
                    <button
                        type="button"
                        onClick={onSearch}
                        data-testid="search-button"
                        className="flex w-full max-w-md items-center justify-between rounded-sm border border-purple-400/20 bg-black/40 px-3 py-1.5 font-mono text-[11px] text-zinc-500 hover:border-purple-300/40 hover:text-zinc-300"
                    >
                        <span>Search files, symbols and summaries…</span>
                        <kbd className="text-[10px] text-zinc-600">{isMac ? "⌘K" : "Ctrl K"}</kbd>
                    </button>
                )}
            </div>
            <div className="flex items-center gap-3">
                {status}
                {/* the lens switcher: Structure is v1's only lens (History arrives with E3, Clusters with E5) */}
                <span className="rounded-sm border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-purple-200">
                    Structure
                </span>
            </div>
        </header>
    );
}
