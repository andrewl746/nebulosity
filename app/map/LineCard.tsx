"use client";

import { useLayoutEffect, type RefObject } from "react";
import { useStore } from "@xyflow/react";
import { formatCount } from "./format";
import type { RunWords } from "./labels";
import { CARD_EDGE, CARD_FRAME, CARD_ROW, hoverCardPlace, hoverCardRows, type CanvasRect } from "./narrow";
import { useSize } from "./useSize";

/** The card's widest, so a long name is cut short rather than stretching it across the canvas. */
const CARD_WIDTH = 280;
/** The rows a pinned card shows before its list scrolls, so it stays a small card beside the run. */
const PINNED_ROWS = 10;

/**
 * What the lines under the pointer are, in words, beside the pointer (the owner, 2026-10-29). Lines that share an end
 * merge, so one line's sentence on a shared run didn't say which line it meant, and drawn over the run it hid the lines
 * it was about. So the card names every line on the run, heaviest first, with its imports ("Into src", then "build
 * 16"), or one line's sentence where a line has the stretch to itself. It sits just below and right of where the
 * pointer landed, inside the canvas and off the line (narrow.ts's hoverCardPlace), and stays put while the pointer
 * stays on that run (MapCanvas). It takes no pointer: reaching for something in it would mean leaving the line, which
 * ends the hover. So it lists five lines and says how many more, and a click on the run pins it (`pinned`): the same card
 * in place, every line in a list that scrolls, closed by Escape, a click elsewhere, or another page (MapCanvas). At
 * screen size whatever the zoom, and as wide as its words up to CARD_WIDTH, and never wider than the canvas.
 */
export default function LineCard({ words, pointer, line, clear, pinned, cardRef, placedRef }: {
    words: RunWords;
    /** Where the pointer landed on the run, in canvas px. */
    pointer: { x: number; y: number };
    /** The bit of line pointed at, as rectangles in canvas px, which the card keeps off. */
    line: readonly CanvasRect[];
    /** What's over the canvas there and then (a drawer, a box's actions, the banner), which the card keeps clear of. */
    clear: readonly CanvasRect[];
    pinned: boolean;
    /** The pinned card's element, for MapCanvas's click elsewhere. */
    cardRef?: RefObject<HTMLDivElement | null>;
    /** Where the card is, for MapCanvas to move it on when the pointer comes onto it. */
    placedRef: RefObject<CanvasRect | null>;
}){
    // measured before the first paint (useSize), and laid out unseen until then, so it never shows a frame out of place
    const [sizeRef, size] = useSize<HTMLDivElement>();
    const canvasWidth = useStore((s) => s.width);
    const canvasHeight = useStore((s) => s.height);
    const place = size === null ? null : hoverCardPlace(pointer, size, { width: canvasWidth, height: canvasHeight }, line, clear);
    useLayoutEffect(() => {
        placedRef.current = place === null || size === null ? null : { ...place, ...size };
    });
    useLayoutEffect(() => () => { placedRef.current = null; }, [placedRef]);

    const room = canvasHeight - 2 * CARD_EDGE;
    const rows = words.kind === "run" ? (pinned ? words.rows.length : hoverCardRows(words.rows.length, room)) : 0;
    const more = words.kind === "run" ? words.rows.length - rows : 0;
    const label = words.kind === "one" ? words.sentence : words.title;
    return (
        <div
            ref={(element) => {
                sizeRef(element);
                if (cardRef) cardRef.current = element;
            }}
            data-line-card={pinned ? "pinned" : "hover"}
            data-lines={words.kind === "one" ? 1 : words.rows.length}
            role={pinned ? "group" : undefined}
            aria-label={label}
            style={{
                left: place?.left ?? 0,
                top: place?.top ?? 0,
                maxWidth: Math.min(CARD_WIDTH, canvasWidth - 2 * CARD_EDGE),
                // the title, PINNED_ROWS rows and the frame, or what the canvas has
                maxHeight: pinned ? Math.min(room, CARD_FRAME + CARD_ROW * (1 + PINNED_ROWS)) : undefined,
                visibility: place === null ? "hidden" : undefined,
            }}
            className={`absolute z-[8] flex w-max flex-col rounded-md border border-border bg-panel py-1 text-[12px] leading-[18px] text-text ${pinned ? "nowheel" : "pointer-events-none"}`}
        >
            {words.kind === "one" ? (
                <p className="flex whitespace-nowrap px-2">
                    <span className="truncate" title={words.parts.who}>{words.parts.who}</span>
                    <span className="shrink-0 whitespace-pre"> {words.parts.verb} </span>
                    <span className="truncate" title={words.parts.whom}>{words.parts.whom}</span>
                    <span className="shrink-0 whitespace-pre">, {words.parts.imports}</span>
                </p>
            ) : (
                <>
                    <p className="flex shrink-0 gap-3 whitespace-nowrap px-2">
                        <span className="truncate font-medium" title={words.title}>{words.title}</span>
                        <span className="ml-auto shrink-0 text-text-3">imports</span>
                    </p>
                    <ul className={pinned ? "overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" : undefined}>
                        {words.rows.slice(0, rows).map((row) => (
                            <li key={row.id} className="flex gap-3 whitespace-nowrap px-2">
                                <span className="truncate text-text-2" title={row.name}>{row.name}</span>
                                <span className="ml-auto shrink-0 tabular-nums">{formatCount(row.count)}</span>
                            </li>
                        ))}
                    </ul>
                    {more > 0 && (
                        <p title={`and ${formatCount(more)} more, click to see all`} className="shrink-0 truncate px-2 text-text-3">and {formatCount(more)} more, click to see all</p>
                    )}
                </>
            )}
        </div>
    );
}
