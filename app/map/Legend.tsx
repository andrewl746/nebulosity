"use client";

import { useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";

/** Remembers in this browser whether the legend was left open. */
const LEGEND_OPEN = "nebulosity.legendOpen";

function readOpen(): boolean {
    try{
        return window.localStorage.getItem(LEGEND_OPEN) === "1";
    } catch{
        return false;   // no storage (a private window): start closed
    }
}

/**
 * What the lines and colors mean (VISUAL_REFRESH.md §4: "label the relationship"), said once in a corner instead of on
 * every line. Closed, it's a small "Legend" button; open, a narrow card of short rows (owner review, 2026-10-13: the wide
 * block ran into the boxes). Like the other overlays it's a solid card in the logo's violet with no outline: lines are
 * never filled, so it can't be mistaken for one (a light outline was), and no box is that colour. Its button is cyan, the
 * color of everything you click.
 * The canvas only renders in the browser, so reading storage on the first render is safe.
 */
export default function Legend({ quietLines }: { quietLines: boolean }){
    const [open, setOpen] = useState(readOpen);
    const toggle = (): void => {
        const next = !open;
        setOpen(next);
        try{
            window.localStorage.setItem(LEGEND_OPEN, next ? "1" : "0");
        } catch{
            // nothing to remember it in
        }
    };
    const Chevron = open ? IconChevronDown : IconChevronUp;

    return (
        <div aria-label="Legend" className={`nopan nodrag nowheel absolute bottom-4 left-4 z-[5] ${open ? "w-[252px]" : ""} rounded-lg bg-overlay text-[12px] text-overlay-text-2`}>
            {open && (
                <div className="space-y-1.5 border-b border-overlay-line px-3 py-2">
                    {/* one sentence for direction: "arrows out / arrows in" rows read as abstract, even to the owner */}
                    <Row glyph={<Arrow color="var(--text-2)" />}>A → B: A uses B. The arrow points at what&apos;s being used.</Row>
                    <Row glyph={<Arrow color="var(--select)" />}>Selected box and its links</Row>
                    <Row glyph={<span className="block h-3 w-3 rounded-sm outline-2 outline-agent" />}>What Claude Code is touching</Row>
                    {quietLines && <Row glyph={<span aria-hidden className="text-[14px] leading-none">⋯</span>}>Busy folder: hover a box to see its lines</Row>}
                </div>
            )}
            <button
                type="button"
                data-testid="legend-toggle"
                onClick={toggle}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-[12px] font-medium text-control hover:bg-overlay-line"
            >
                Legend
                <Chevron aria-hidden size={16} stroke={1.75} />
            </button>
        </div>
    );
}

function Row({ glyph, children }: { glyph: ReactNode; children: ReactNode }){
    return (
        <div className="flex items-start gap-2">
            <span aria-hidden className="flex h-4 w-6 shrink-0 items-center justify-center">{glyph}</span>
            <span className="leading-4">{children}</span>
        </div>
    );
}

function Arrow({ color }: { color: string }){
    return (
        <svg width="24" height="8" viewBox="0 0 24 8" style={{ color }}>
            <line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M17 0.5 L24 4 L17 7.5 Z" fill="currentColor" />
        </svg>
    );
}
