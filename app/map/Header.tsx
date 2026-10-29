"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import { IconSearch } from "@tabler/icons-react";
import BackButton from "./BackButton";
import { DEMO } from "./mode";

type HeaderProps = {
    /** The breadcrumb, with the repo's name and picker first (Breadcrumb, RepoMenu). */
    crumb: ReactNode;
    onSearch: () => void;
    onHelp: () => void;
    /** Inside VS Code's panel: no logo and no help button (the ? key still opens it). */
    embedded: boolean;
    /** Whether Back has one of the Map's own steps to go back to (history.ts's historyDepth). */
    canGoBack: boolean;
    /** A short window's toolbar, folded into this bar (shell.ts). */
    toolbar?: ReactNode;
    /** A very short window's status dots, at the bar's end (shell.ts). */
    status?: ReactNode;
};

const noSubscription = () => () => {};

/**
 * The search field's icon form: under 640 px, or under 1000 where the toolbar's controls share the bar (and gone under
 * 360). As a field it gives way before the breadcrumb does (flex-shrink 1000 to its 1), down to 160 px.
 */
const SEARCH_ICON = {
    alone: { field: "max-[640px]:min-w-0 max-[640px]:w-7 max-[640px]:flex-none max-[640px]:cursor-pointer max-[640px]:justify-center max-[640px]:p-0", words: "max-[640px]:hidden" },
    shared: { field: "max-[1000px]:min-w-0 max-[1000px]:w-7 max-[1000px]:flex-none max-[1000px]:cursor-pointer max-[1000px]:justify-center max-[1000px]:p-0 max-[360px]:hidden", words: "max-[1000px]:hidden" },
};

/**
 * The Map's one top bar (the Workbench redesign, ADR-070), 42 px, 38 inside VS Code's panel. Left to right: the logo
 * and name, Back, the breadcrumb in mono with the repo first, the search field, and help. In the demo the logo goes to
 * nebulosity.ca (the owner, 2026-10-27). Inside VS Code's panel it's Back, the breadcrumb and search, since VS Code has
 * its own chrome. Back is the same button in the browser, the demo and the panel, right before the breadcrumb it
 * changes, and greyed out where none of the Map's own steps lie behind it (the owner's pick, 2026-10-29).
 *
 * A narrower window drops secondary parts one step at a time, so nothing sits on anything else and nothing scrolls
 * sideways: under 1000 px the search's shortcut, under 900 the Nebulosity name (the mark stays), under 640 the search's
 * words (the field becomes its icon), and under 480 the help button (the toolbar's … menu has it). Under 360 the mark
 * and its divider go too, and the bar's gaps and Back's box narrow (24 px, 4 px from the breadcrumb), so the folder on
 * screen keeps a readable name at 200 × 200 with the toolbar and the status dots in this bar. Back never goes, so under
 * 360 the browser's bar is the panel's. The breadcrumb takes what's left and folds its middle (under 360 the repo's
 * name with it). In a short window the toolbar's controls and then the status dots join this bar, which then has less
 * to give: the search is its icon under 1000 px, and under 360 it moves into the toolbar's … menu (Ctrl K still opens
 * it).
 */
export default function Header({ crumb, onSearch, onHelp, embedded, canGoBack, toolbar, status }: HeaderProps){
    // the server renders "Ctrl K"; a Mac shows "⌘K" once hydrated, without a mismatch
    const isMac = useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);
    const icon = toolbar ? SEARCH_ICON.shared : SEARCH_ICON.alone;
    const brand = (
        <>
            <Image src="/icon.svg" alt="" width={18} height={18} unoptimized className="shrink-0" />
            <span className="text-[13px] font-semibold text-text max-[900px]:hidden">Nebulosity</span>
        </>
    );
    return (
        <header className={`relative z-20 flex shrink-0 items-center gap-3 border-b border-divider bg-panel pl-3 pr-2.5 max-[360px]:gap-1.5 max-[360px]:pl-2 max-[360px]:pr-1.5 ${embedded ? "h-[38px]" : "h-[42px]"}`}>
            {/* at its natural width, so a long breadcrumb takes room from the search field before it truncates */}
            <div className="flex min-w-0 flex-[1_1_auto] items-center gap-2.5 max-[360px]:gap-1">
                {!embedded && (DEMO
                    ? <a href="https://nebulosity.ca" title="nebulosity.ca" className="flex shrink-0 items-center gap-2 rounded-[4px] max-[360px]:hidden">{brand}</a>
                    : <span className="flex shrink-0 items-center gap-2 max-[360px]:hidden">{brand}</span>)}
                {!embedded && <span aria-hidden className="h-4 w-px shrink-0 bg-divider max-[360px]:hidden" />}
                <BackButton enabled={canGoBack} />
                {crumb}
            </div>
            <button
                type="button"
                onClick={onSearch}
                data-testid="search-button"
                aria-label="Search files and concepts"
                title={`Search files and concepts (${isMac ? "⌘K" : "Ctrl K"})`}
                className={`flex h-7 min-w-[160px] flex-[0_1000_440px] cursor-text items-center gap-2 rounded-[5px] border border-border bg-canvas pl-2.5 pr-1.5 text-[13px] text-text-3 hover:border-text-3 ${icon.field}`}
            >
                <IconSearch aria-hidden size={14} stroke={2} className="shrink-0" />
                <span className={`w-0 flex-1 truncate text-left ${icon.words}`}>Search files and concepts</span>
                <kbd className="shrink-0 rounded-[4px] border border-border px-1.5 font-sans text-[11.5px] leading-[17px] text-text-3 max-[1000px]:hidden">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </button>
            {/* as wide as the left side while the search field is centred, and only its own width once it's an icon; never
                narrower than what it holds, which would spill left over the search field (its end is aligned) */}
            <div className={`flex items-center justify-end gap-1.5 ${toolbar ? "shrink-0" : "flex-1 max-[640px]:flex-none"}`}>
                {toolbar}
                {!embedded && (
                    <button
                        type="button"
                        onClick={onHelp}
                        data-testid="help-button"
                        aria-label="How to use the Map"
                        title="How to use the Map (?)"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] border border-border text-[13px] font-semibold text-text-2 hover:border-text-3 hover:text-text max-[480px]:hidden"
                    >
                        ?
                    </button>
                )}
                {status}
            </div>
        </header>
    );
}
