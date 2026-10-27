"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { trailStart } from "./narrow";
import { nameOf } from "./paths";
import { placePopover, usePlaceOnResize } from "./popover";
import { useDismiss } from "./useDismiss";

type BreadcrumbProps = {
    /** The repo's name, which goes to the top level, with its picker when several repos are indexed (RepoMenu). */
    repo: ReactNode;
    /** The repo's root path, for the steps' titles. */
    repoRoot: string;
    /** Folder paths from the root down to the one on screen: ["", "src", "src/vs"]. */
    trail: readonly string[];
    onOpen: (folder: string) => void;
};

/** The space between steps (gap-1), and the folded folders' menu width. */
const STEP_GAP = 4;
const MENU_WIDTH = 260;

/**
 * Where the Map is, in mono: "microsoft/vscode / src / vs / workbench" (the Workbench redesign, ADR-070). The repo
 * comes first and every step but the last goes back up to it; at the top level it reads "microsoft/vscode / root".
 *
 * When the trail doesn't fit (a deep folder, a narrow window), it keeps the repo and the folder on screen and folds the
 * folders between into a "…" that opens a list of them to jump to (the owner, 2026-10-27). It never scrolls sideways.
 * When even that is too wide, the repo's name truncates first, then the folder on screen, each whole in its title. The
 * steps' natural widths come from a hidden copy of the trail, measured whenever it or the room for it changes.
 */
export default function Breadcrumb({ repo, repoRoot, trail, onOpen }: BreadcrumbProps){
    const steps = trail.slice(1);
    const nav = useRef<HTMLElement>(null);
    const repoBox = useRef<HTMLSpanElement>(null);
    const ruler = useRef<HTMLDivElement>(null);
    // how many folders after the repo are folded into "…", for the trail it was measured on
    const [fold, setFold] = useState<{ trail: readonly string[]; count: number }>({ trail, count: 0 });
    const folded = fold.trail === trail ? fold.count : 0;

    // measured before the browser paints the new trail, so a deep folder's whole trail never shows for a frame over its
    // neighbours, then again whenever the room or a step's width changes (the window resized, the font arrived)
    useLayoutEffect(() => {
        const navEl = nav.current, rulerEl = ruler.current, repoEl = repoBox.current;
        if (!navEl || !rulerEl || !repoEl) return;
        const measure = (): void => {
            const widths = [...rulerEl.children].map((step) => step.getBoundingClientRect().width);
            const ellipsis = widths.pop() ?? 0;   // the ruler ends with the "…" step
            const room = navEl.getBoundingClientRect().width - repoEl.getBoundingClientRect().width - STEP_GAP;
            // the steps fold from the one after the repo onward; the last always stays (narrow.ts's trailStart)
            const count = widths.length === 0 ? 0 : trailStart(widths, room, ellipsis, STEP_GAP);
            setFold((last) => last.trail === trail && last.count === count ? last : { trail, count });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(navEl);
        observer.observe(repoEl);
        for (const step of rulerEl.children) observer.observe(step);
        return () => observer.disconnect();
    }, [trail]);

    const here = steps.length === 0 ? "root" : nameOf(steps[steps.length - 1], repoRoot);
    return (
        <nav ref={nav} aria-label="Where you are" className="relative flex min-w-0 flex-1 items-center gap-1 font-mono text-[12.5px] text-text-2">
            <span ref={repoBox} className="flex min-w-0 shrink items-center">{repo}</span>
            {folded > 0 && (
                <>
                    <span aria-hidden className="shrink-0">/</span>
                    <FoldedSteps steps={steps.slice(0, folded)} repoRoot={repoRoot} onOpen={onOpen} />
                </>
            )}
            {steps.map((step, i) => i < folded ? null : (
                <span key={step} className={`flex items-center gap-1 ${i === steps.length - 1 ? "min-w-0" : "shrink-0"}`}>
                    <span aria-hidden>/</span>
                    {i === steps.length - 1
                        ? <span aria-current="page" title={step} className="truncate text-text">{nameOf(step, repoRoot)}</span>
                        : <button type="button" onClick={() => onOpen(step)} title={step} className="truncate rounded-[4px] px-0.5 hover:bg-node hover:text-text">{nameOf(step, repoRoot)}</button>}
                </span>
            ))}
            {steps.length === 0 && (
                <span className="flex shrink-0 items-center gap-1"><span aria-hidden>/</span><span aria-current="page" className="text-text-2">{here}</span></span>
            )}
            {/* the steps at their natural width, unseen and unclickable, for measuring; the "…" step last */}
            <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 flex h-0 gap-1 overflow-hidden whitespace-nowrap">
                {steps.map((step) => (
                    <span key={step} className="flex shrink-0 items-center gap-1"><span>/</span><span className="px-0.5">{nameOf(step, repoRoot)}</span></span>
                ))}
                <span className="flex shrink-0 items-center gap-1"><span>/</span><span className="px-1.5">…</span></span>
            </div>
        </nav>
    );
}

/** The "…" for the folders folded out of the trail, and the list of them it opens, each one a way up to it. */
function FoldedSteps({ steps, repoRoot, onOpen }: { steps: readonly string[]; repoRoot: string; onOpen: (folder: string) => void }){
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<CSSProperties>({ left: 0, width: MENU_WIDTH });
    const ref = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
    const placeMenu = useCallback(() => {
        if (ref.current) setPlace(placePopover(ref.current, MENU_WIDTH, "start"));
    }, [ref]);
    usePlaceOnResize(open, placeMenu);
    return (
        <span ref={ref} className="relative shrink-0">
            <button
                type="button"
                data-testid="breadcrumb-folded"
                aria-expanded={open}
                aria-label={`${steps.length} more ${steps.length === 1 ? "folder" : "folders"} on the way here`}
                title={steps.map((step) => nameOf(step, repoRoot)).join(" / ")}
                onClick={() => {
                    if (!open) placeMenu();
                    setOpen((o) => !o);
                }}
                className="rounded-[4px] border border-border px-1.5 leading-[18px] hover:bg-node hover:text-text"
            >
                …
            </button>
            {open && (
                <ul data-testid="breadcrumb-menu" data-covers style={place} className="absolute top-7 z-30 overflow-y-auto rounded-md border border-border bg-panel py-1 font-sans text-[13px]">
                    {steps.map((step) => (
                        <li key={step}>
                            <button type="button" onClick={() => { setOpen(false); onOpen(step); }} title={step} className="block w-full truncate px-3 py-1.5 text-left font-mono text-[12.5px] text-text hover:bg-node">
                                {nameOf(step, repoRoot)}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </span>
    );
}
