"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import { IconHelp, IconSearch } from "@tabler/icons-react";

type TopBarProps = {
    /** The repo as "owner / repo", or the repo picker. */
    repo: ReactNode;
    /** Opens ⌘K search. The field appears once it's passed. */
    onSearch?: () => void;
    /** The index-status dot. */
    status?: ReactNode;
    /** Opens the help (owner review). */
    onHelp?: () => void;
};

const noSubscription = () => () => {};

/**
 * The top bar (VISUAL_REFRESH.md §6), left to right: the Nebulosity mark and name, the repo as "owner / repo", the
 * view's title, a wide search field, and the index status on the right. Structure is v1's only lens, so the view title
 * stands where PIVOT_SPEC.md §7's lens switcher will go when History (E3) and Clusters (E5) arrive.
 *
 * A narrower window drops secondary text, one piece per step (VISUAL_REFRESH.md, "Narrow windows"), so nothing ever
 * sits on anything else: under 1100 px the view title, under 768 the search's shortcut (sooner if the field can't hold
 * it and its words whole), under 640 its words (it becomes an icon beside the help), under 520 the status pill's words
 * (StatusPill), under 440 the Nebulosity name beside the mark. Between steps the search's words truncate first, then
 * the status words and the repo's owner, then its name, each whole in a title. The steps go by the window's width,
 * which is the Map's own down to the floor (narrow.ts); under the floor every step has been taken.
 */
export default function TopBar({ repo, onSearch, status, onHelp }: TopBarProps){
    // the server renders "Ctrl K"; a Mac shows "⌘K" once hydrated, without a mismatch
    const isMac = useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);

    return (
        <header className="pointer-events-auto relative z-20 flex h-12 shrink-0 items-center gap-4 border-b border-divider bg-canvas px-4 max-[440px]:gap-3">
            <div className="flex shrink-0 items-center gap-2">
                <Image src="/icon.svg" alt="" width={18} height={18} unoptimized />
                <span className="text-[14px] font-medium text-text max-[440px]:hidden">Nebulosity</span>
            </div>
            <span aria-hidden className="h-4 w-px shrink-0 bg-divider" />
            <div className="flex min-w-0 items-center gap-3">
                {repo}
                <span className="shrink-0 text-[13px] text-text-2 max-[1100px]:hidden">Dependency map</span>
            </div>
            {/* the search field takes what the bar has left, so its words (w-0: they don't hold the field open) truncate
                before the repo's name or the status words do; a container, so its shortcut goes as soon as the field
                can't hold it and the words whole (256 px), the words before they're cut to a letter (90 px), and it's
                never narrower than its icon */}
            <div className="@container flex min-w-[42px] flex-1 justify-center max-[640px]:justify-end">
                {onSearch && (
                    <button
                        type="button"
                        onClick={onSearch}
                        data-testid="search-button"
                        aria-label="Search files and concepts"
                        title={`Search files and concepts (${isMac ? "⌘K" : "Ctrl K"})`}
                        className="flex w-full max-w-xl cursor-text items-center gap-2 rounded-lg border border-border bg-node px-3 py-1.5 text-[13px] text-text-2 hover:border-text-2 max-[640px]:w-auto max-[640px]:cursor-pointer max-[640px]:px-2"
                    >
                        <IconSearch aria-hidden size={16} stroke={1.75} className="shrink-0" />
                        <span className="w-0 flex-1 truncate text-left max-[640px]:hidden @max-[90px]:hidden">Search files and concepts</span>
                        <kbd className="shrink-0 rounded-md border border-border px-1.5 font-sans text-[12px] text-text-2 max-[768px]:hidden @max-[256px]:hidden">{isMac ? "⌘K" : "Ctrl K"}</kbd>
                    </button>
                )}
            </div>
            <div className="flex min-w-0 items-center gap-2">
                {onHelp && (
                    <button
                        type="button"
                        onClick={onHelp}
                        data-testid="help-button"
                        aria-label="How to use the Map"
                        title="How to use the Map (?)"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-text-2 hover:border-text-2 hover:text-text"
                    >
                        <IconHelp aria-hidden size={16} stroke={1.75} />
                    </button>
                )}
                {status}
            </div>
        </header>
    );
}
