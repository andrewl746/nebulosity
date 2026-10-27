"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { trailStart } from "./narrow";
import { nameOf } from "./paths";

type BreadcrumbProps = { repo: string; trail: readonly string[]; onOpen: (folder: string) => void };

/** The space between steps (gap-1). */
const STEP_GAP = 4;

/**
 * Where the Map is: "vscode / src / vs" (VISUAL_REFRESH.md §4). Every step but the last goes back up to it.
 *
 * When the trail doesn't fit (a deep folder, a narrow window), it truncates from its start: the first steps fold into
 * one "…", which goes up to the last of them and names them all in its title, so the current folder always shows
 * (truncating itself, whole in its title, if even it is too wide). The steps' natural widths come from a hidden copy
 * of the trail, measured whenever it or the room for it changes (narrow.ts's trailStart decides how many fold).
 */
export default function Breadcrumb({ repo, trail, onOpen }: BreadcrumbProps){
    const nav = useRef<HTMLElement>(null);
    const ruler = useRef<HTMLDivElement>(null);
    // how many steps from the start are folded into "…", for the trail it was measured on
    const [fold, setFold] = useState<{ trail: readonly string[]; count: number }>({ trail, count: 0 });
    const folded = fold.trail === trail ? fold.count : 0;

    // measured before the browser paints the new trail, so a deep folder's whole trail never shows for a frame over its
    // neighbours; then again whenever the room or a step's width changes (the window resized, the font arrived)
    useLayoutEffect(() => {
        const navEl = nav.current, rulerEl = ruler.current;
        if (!navEl || !rulerEl) return;
        const measure = (): void => {
            const widths = [...rulerEl.children].map((step) => step.getBoundingClientRect().width);
            const ellipsis = widths.pop() ?? 0;   // the ruler ends with the "…" step
            // the steps' widths are fractional, so the room is too: a whole-pixel clientWidth could fold a step that fits
            const count = trailStart(widths, navEl.getBoundingClientRect().width, ellipsis, STEP_GAP);
            setFold((last) => last.trail === trail && last.count === count ? last : { trail, count });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(navEl);
        // each step, not the ruler itself: the ruler is the nav's width whatever its text, so only the steps change size
        for (const step of rulerEl.children) observer.observe(step);
        return () => observer.disconnect();
    }, [trail]);

    const label = (step: string, last: boolean) => last
        ? <span aria-current="page" title={step || nameOf(step, repo)} className="truncate px-1 font-medium text-text">{nameOf(step, repo)}</span>
        : <button type="button" onClick={() => onOpen(step)} title={step || nameOf(step, repo)} className="truncate rounded-md px-1 hover:bg-node hover:text-text">{nameOf(step, repo)}</button>;

    return (
        <nav ref={nav} aria-label="Where you are" className="relative flex min-w-0 flex-1 items-center gap-1 text-[14px] text-text-2">
            {folded > 0 && (
                <button
                    type="button"
                    data-testid="breadcrumb-folded"
                    onClick={() => onOpen(trail[folded - 1])}
                    title={`Up to ${nameOf(trail[folded - 1], repo)}: ${trail.slice(0, folded).map((step) => nameOf(step, repo)).join(" / ")}`}
                    aria-label={`Up to ${nameOf(trail[folded - 1], repo)}`}
                    className="shrink-0 rounded-md px-1 hover:bg-node hover:text-text"
                >
                    …
                </button>
            )}
            {trail.map((step, i) => i < folded ? null : (
                <span key={step || "(root)"} className={`flex items-center gap-1 ${i === trail.length - 1 ? "min-w-0" : "shrink-0"}`}>
                    {i > 0 && <span aria-hidden>/</span>}
                    {label(step, i === trail.length - 1)}
                </span>
            ))}
            {/* the trail at its natural width, unseen and unclickable, for measuring; the "…" step last */}
            <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 flex h-0 gap-1 overflow-hidden whitespace-nowrap">
                {trail.map((step, i) => (
                    <span key={step || "(root)"} className="flex shrink-0 items-center gap-1">
                        {i > 0 && <span>/</span>}
                        <span className={`px-1 ${i === trail.length - 1 ? "font-medium" : ""}`}>{nameOf(step, repo)}</span>
                    </span>
                ))}
                <span className="shrink-0 px-1">…</span>
            </div>
        </nav>
    );
}
