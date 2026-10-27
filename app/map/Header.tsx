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
    /** Inside VS Code's panel: Back first, no logo and no help button (the ? key still opens it). */
    embedded: boolean;
    canGoBack: boolean;
    /** A short window's toolbar, folded into this bar (shell.ts). */
    toolbar?: ReactNode;
    /** A very short window's status dots, at the bar's end (shell.ts). */
    status?: ReactNode;
};

const noSubscription = () => () => {};

/**
 * The Map's one top bar (the Workbench redesign, ADR-070), 42 px, 38 inside VS Code's panel. Left to right: the logo
 * and name, the breadcrumb in mono with the repo first, the search field, and help. In the demo the logo goes to
 * nebulosity.ca (the owner, 2026-10-27). Inside VS Code's panel it's Back, the breadcrumb and search, since VS Code has
 * its own chrome.
 *
 * A narrower window drops secondary parts one step at a time, so nothing sits on anything else and nothing scrolls
 * sideways: under 1000 px the search's shortcut, under 900 the Nebulosity name (the mark stays), under 640 the search's
 * words (the field becomes its icon), and under 480 the help button (the toolbar's … menu has it). The breadcrumb takes
 * what's left and folds its middle. In a short window the toolbar's controls and then the status dots join this bar.
 */
export default function Header({ crumb, onSearch, onHelp, embedded, canGoBack, toolbar, status }: HeaderProps){
    // the server renders "Ctrl K"; a Mac shows "⌘K" once hydrated, without a mismatch
    const isMac = useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);
    const brand = (
        <>
            <Image src="/icon.svg" alt="" width={18} height={18} unoptimized className="shrink-0" />
            <span className="text-[13px] font-semibold text-text max-[900px]:hidden">Nebulosity</span>
        </>
    );
    return (
        <header className={`relative z-20 flex shrink-0 items-center gap-3 border-b border-divider bg-panel pl-3 pr-2.5 ${embedded ? "h-[38px]" : "h-[42px]"}`}>
            {/* at its natural width, so a long breadcrumb takes room from the search field before it truncates */}
            <div className="flex min-w-0 flex-[1_1_auto] items-center gap-2.5">
                {embedded
                    ? <BackButton enabled={canGoBack} />
                    : DEMO
                        ? <a href="https://nebulosity.ca" title="nebulosity.ca" className="flex shrink-0 items-center gap-2 rounded-[4px]">{brand}</a>
                        : <span className="flex shrink-0 items-center gap-2">{brand}</span>}
                {!embedded && <span aria-hidden className="h-4 w-px shrink-0 bg-divider" />}
                {crumb}
            </div>
            <button
                type="button"
                onClick={onSearch}
                data-testid="search-button"
                aria-label="Search files and concepts"
                title={`Search files and concepts (${isMac ? "⌘K" : "Ctrl K"})`}
                className="flex h-7 min-w-0 flex-[0_1_440px] cursor-text items-center gap-2 rounded-[5px] border border-border bg-canvas pl-2.5 pr-1.5 text-[13px] text-text-3 hover:border-text-3 max-[640px]:w-7 max-[640px]:flex-none max-[640px]:cursor-pointer max-[640px]:justify-center max-[640px]:p-0"
            >
                <IconSearch aria-hidden size={14} stroke={2} className="shrink-0" />
                <span className="w-0 flex-1 truncate text-left max-[640px]:hidden">Search files and concepts</span>
                <kbd className="shrink-0 rounded-[4px] border border-border px-1.5 font-sans text-[11.5px] leading-[17px] text-text-3 max-[1000px]:hidden">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </button>
            {/* as wide as the left side while the search field is centred, and only its own width once it's an icon */}
            <div className={`flex min-w-0 items-center justify-end gap-1.5 ${toolbar ? "shrink-0" : "flex-1 max-[640px]:flex-none"}`}>
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
