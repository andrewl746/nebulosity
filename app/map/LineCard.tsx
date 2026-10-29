"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { useStore } from "@xyflow/react";
import { formatCount } from "./format";
import type { RunWords } from "./labels";
import { CARD_EDGE, CARD_FRAME, CARD_ROW, hoverCardPlace, hoverCardRoom, hoverCardRows, type CanvasRect, type CardCorner } from "./narrow";
import { useSize } from "./useSize";

/** The card's widest, so a long name is cut short rather than stretching it across the canvas. */
const CARD_WIDTH = 280;
/** The corner of the pointer the card tries first (narrow.ts's hoverCardPlace). */
const CARD_CORNER: CardCorner = "below-right";
/** The rows a pinned card shows before its list scrolls, so it stays a small card beside the run. */
const PINNED_ROWS = 10;

/** Where the pointer is on the run (canvas px), and the bit of line there and what's over the canvas, which the card keeps off. */
export type CardAt = { pointer: { x: number; y: number }; line: readonly CanvasRect[]; clear: readonly CanvasRect[] };

/**
 * What the lines under the pointer are, in words, at the pointer (the owner, 2026-10-29). Lines that share an end
 * merge, so one line's sentence on a shared run didn't say which line it meant, and drawn over the run it hid the lines
 * it was about. So the card names every line on the run, heaviest first, with its imports ("Into src", then "build
 * 16"), or one line's sentence where a line has the stretch to itself. It sits just below and right of the pointer,
 * inside the canvas and off the line (narrow.ts's hoverCardPlace), and goes with the pointer along the run (`followRef`:
 * left where the pointer first landed, it sat far down a long line from it, owner review). It takes no pointer: reaching
 * for something in it would mean leaving the line, which ends the hover. So it lists five lines and says how many more,
 * and a click on the run pins it (`pinned`): the same card where it is, every line in a list that scrolls, closed by
 * Escape, a click elsewhere, or another page (MapCanvas). At screen size whatever the zoom, and as wide as its words up
 * to CARD_WIDTH, and never wider than the canvas.
 */
export default function LineCard({ words, at: landed, pinned, cardRef, followRef }: {
    words: RunWords;
    /** Where the pointer was when the card came up. */
    at: CardAt;
    pinned: boolean;
    /** The pinned card's element, for MapCanvas's click elsewhere. */
    cardRef?: RefObject<HTMLDivElement | null>;
    /** Where MapCanvas hands the hover card the pointer as it moves along the run, without drawing the canvas again. */
    followRef?: RefObject<((at: CardAt) => void) | null>;
}){
    const [at, setAt] = useState(landed);
    useLayoutEffect(() => {
        if (followRef === undefined) return;
        followRef.current = setAt;
        return () => { followRef.current = null; };
    }, [followRef]);
    // measured before the first paint (useSize), and laid out unseen until then, so it never shows a frame out of place
    const [sizeRef, size] = useSize<HTMLDivElement>();
    const canvasWidth = useStore((s) => s.width);
    const canvasHeight = useStore((s) => s.height);
    const place = size === null ? null : hoverCardPlace(at.pointer, size, { width: canvasWidth, height: canvasHeight }, at.line, at.clear, CARD_CORNER);

    // as many rows as fit over or under the pointer, so the card keeps off it; in a canvas with no room even for the
    // title and "and N more", the title alone says how many lines there are ("Into utils.ts", "43 lines")
    const room = hoverCardRoom(at.pointer.y, canvasHeight);
    const titleOnly = !pinned && words.kind === "run" && room < CARD_FRAME + 2 * CARD_ROW;
    const rows = words.kind === "run" && !titleOnly ? (pinned ? words.rows.length : hoverCardRows(words.rows.length, room)) : 0;
    const more = words.kind === "run" && !titleOnly ? words.rows.length - rows : 0;
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
                // the title, PINNED_ROWS rows and the frame, or what there is over or under the pointer, but always
                // the title and a row, which a canvas too short for that has to take over the pointer
                maxHeight: pinned ? Math.min(Math.max(room, CARD_FRAME + 2 * CARD_ROW), CARD_FRAME + CARD_ROW * (1 + PINNED_ROWS)) : undefined,
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
                        <span className="ml-auto shrink-0 text-text-3">{titleOnly ? `${formatCount(words.rows.length)} lines` : "imports"}</span>
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
