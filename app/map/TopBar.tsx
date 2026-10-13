"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import { IconSearch } from "@tabler/icons-react";

type TopBarProps = {
    /** The repo as "owner / repo", or the repo picker. */
    repo: ReactNode;
    /** Opens ⌘K search. The field appears once it's passed. */
    onSearch?: () => void;
    /** The index-status dot. */
    status?: ReactNode;
};

const noSubscription = () => () => {};

/**
 * The top bar (VISUAL_REFRESH.md §6), left to right: the Nebulosity mark and name, the repo as "owner / repo", the
 * view's title, a wide search field, and the index status on the right. Structure is v1's only lens, so the view title
 * stands where PIVOT_SPEC.md §7's lens switcher will go when History (E3) and Clusters (E5) arrive.
 */
export default function TopBar({ repo, onSearch, status }: TopBarProps){
    // the server renders "Ctrl K"; a Mac shows "⌘K" once hydrated, without a mismatch
    const isMac = useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);

    return (
        <header className="pointer-events-auto relative z-20 flex h-12 shrink-0 items-center gap-4 border-b border-hairline bg-canvas px-4">
            <div className="flex shrink-0 items-center gap-2">
                <Image src="/icon.svg" alt="" width={18} height={18} unoptimized />
                <span className="text-[14px] font-medium text-text">Nebulosity</span>
            </div>
            <span aria-hidden className="h-4 w-px shrink-0 bg-hairline" />
            <div className="flex min-w-0 items-center gap-3">
                {repo}
                <span className="shrink-0 text-[13px] text-text-2">Dependency map</span>
            </div>
            <div className="flex min-w-0 flex-1 justify-center">
                {onSearch && (
                    <button
                        type="button"
                        onClick={onSearch}
                        data-testid="search-button"
                        className="flex w-full max-w-xl cursor-text items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-2 hover:border-text-2"
                    >
                        <IconSearch aria-hidden size={16} stroke={1.75} className="shrink-0" />
                        <span className="flex-1 truncate text-left">Search files and concepts</span>
                        <kbd className="shrink-0 rounded-md border border-border px-1.5 font-sans text-[12px] text-text-2">{isMac ? "⌘K" : "Ctrl K"}</kbd>
                    </button>
                )}
            </div>
            <div className="flex shrink-0 items-center">{status}</div>
        </header>
    );
}
