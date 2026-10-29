"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { useStore } from "@xyflow/react";
import { formatCount } from "./format";
import type { RunWords } from "./labels";
import {
    bubblePlace, bubbleRoom, CARD_EDGE, CARD_FRAME, CARD_ROW, hoverCardRows, insideCanvas, TAIL_BASE, TAIL_LENGTH,
    type BubblePlace, type CanvasRect, type TailSide,
} from "./narrow";
import type { Point } from "./routes";
import { useSize } from "./useSize";

/** The card's widest, so a long name is cut short rather than stretching it across the canvas. */
const CARD_WIDTH = 280;
/** The rows a pinned card shows before its list scrolls, so it stays a small card beside the run. */
const PINNED_ROWS = 10;

/**
 * The spot on the run nearest the pointer, on the canvas (canvas px) and on the Map (`spot`, the Map's own coordinates),
 * whether the line runs up and down there and half its width on screen, and the bit of line there and what's over the
 * canvas, which the card keeps off.
 */
export type CardAt = { point: Point; spot: Point; upright: boolean; half: number; line: readonly CanvasRect[]; clear: readonly CanvasRect[] };
/** Where a hover card is on the canvas, with its tail, so a click can pin it just as it is. */
export type CardPlace = BubblePlace & { width: number; height: number };

/**
 * What the lines under the pointer are, in words, pointing at the line (the owner, 2026-10-29). Lines that share an end
 * merge, so one line's sentence on a shared run didn't say which line it meant, and drawn over the run it hid the lines
 * it was about. So the card names every line on the run, heaviest first, with its imports ("Into src", then "build
 * 16"), or one line's sentence where a line has the stretch to itself. A tail like a speech bubble's points from it
 * across the line at the spot nearest the pointer, its tip just short of the line, one size always (the owner's idea),
 * so the card sits beside the line, above and left of the spot where it can (narrow.ts's bubblePlace), inside the
 * canvas, and goes with the pointer along the run (`followRef`: left where the pointer first landed, it sat far down a
 * long line from it, owner review). It takes no pointer: reaching for something in it would mean leaving the line, which
 * ends the hover. So it lists five lines and says how many more.
 *
 * A click on the run pins it (`pinned`, `held`): the same card, where it was and as wide, that only grows, away from
 * its tail, to list every line, scrolling past PINNED_ROWS (a pinned card placed afresh changed shape on the click,
 * owner review), its tail still on the spot once the pointer has gone. The wheel zooming the canvas keeps it beside that
 * spot, kept inside the canvas, without its tail where that moved it off (the owner, 2026-10-29), and Escape, a click
 * elsewhere, or another page closes it (MapCanvas). At screen size whatever the zoom, as wide as its words up to
 * CARD_WIDTH, and never wider than the canvas.
 */
export default function LineCard({ words, at: landed, pinned, held, cardRef, followRef, placedRef }: {
    words: RunWords;
    /** Where the pointer was on the run when the card came up. */
    at: CardAt;
    pinned: boolean;
    /** The hover card a pinned one stays in the place of, if it was up (a tap pins one with none before it). */
    held?: CardPlace | null;
    /** The pinned card's element, for MapCanvas's click elsewhere. */
    cardRef?: RefObject<HTMLDivElement | null>;
    /** Where MapCanvas hands the hover card the pointer as it moves along the run, without drawing the canvas again. */
    followRef?: RefObject<((at: CardAt) => void) | null>;
    /** Where the hover card is, for a click to pin it there. */
    placedRef?: RefObject<CardPlace | null>;
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
    const canvas = { width: canvasWidth, height: canvasHeight };
    const hold = pinned ? held ?? null : null;
    // a pinned card goes where the spot it was clicked at goes on screen, as the wheel zooms the canvas round the pointer
    const view = useStore((s) => (pinned ? s.transform : null));
    const shift = view === null ? { x: 0, y: 0 } : { x: at.spot.x * view[2] + view[0] - at.point.x, y: at.spot.y * view[2] + view[1] - at.point.y };
    const base = size === null ? null
        : hold !== null ? grown(hold, size)
        : bubblePlace(at.point, at.upright, at.half, size, canvas, at.line, at.clear);
    let place = base;
    if (pinned && base !== null && size !== null){
        const moved = { left: base.left + shift.x, top: base.top + shift.y };
        const kept = insideCanvas(moved, size, canvas);
        // moved inside the canvas, it's no longer the tail's length from the spot, so it has no tail
        place = { ...base, ...kept, tail: kept.left === moved.left && kept.top === moved.top ? base.tail : null };
    }
    useLayoutEffect(() => {
        if (placedRef === undefined) return;
        placedRef.current = place === null || size === null ? null : { ...place, ...size };
    });

    // as many rows as fit over or under the spot, past the tail, so the card keeps its tail and stays off the line; in a
    // canvas with no room even for the title and "and N more", the title alone says how many lines there are
    // ("Into utils.ts", "43 lines")
    const room = hold !== null
        ? Math.max(hold.height, hold.rises ? hold.top + hold.height - CARD_EDGE : canvasHeight - CARD_EDGE - hold.top)
        : Math.max(bubbleRoom(at.point, at.upright, at.half, size?.width ?? Math.min(CARD_WIDTH, canvasWidth - 2 * CARD_EDGE), canvas), pinned ? CARD_FRAME + 2 * CARD_ROW : 0);
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
                width: hold?.width,
                maxWidth: Math.min(CARD_WIDTH, canvasWidth - 2 * CARD_EDGE),
                // pinned: the title, PINNED_ROWS rows and the frame, or the room it has, and never less than it was
                maxHeight: pinned ? Math.min(room, Math.max(hold?.height ?? 0, CARD_FRAME + CARD_ROW * (1 + PINNED_ROWS))) : undefined,
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
                    <ul className={pinned ? "min-h-0 overflow-y-auto overscroll-contain" : undefined}>
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
            {place?.tail && <Tail side={place.tail.side} at={place.tail.at} />}
        </div>
    );
}

/** A held card grown to `size`: its left and its edge at the tail kept, so one rising from its tail grows up. */
function grown(hold: CardPlace, size: { width: number; height: number }): BubblePlace {
    const rise = hold.rises ? size.height - hold.height : 0;
    const side = hold.tail?.side;
    return {
        left: hold.left,
        top: hold.top - rise,
        // a tail on the card's side stays the same way from its bottom as the card rises
        tail: hold.tail && (side === "left" || side === "right") ? { side: hold.tail.side, at: hold.tail.at + rise } : hold.tail,
        rises: hold.rises,
    };
}

/**
 * The card's tail, a triangle TAIL_BASE wide and TAIL_LENGTH long out of side `side`, its middle `at` px along it from
 * the card's left or top. Its base lies on the card's border, which its fill hides, and its two other sides are drawn in
 * the border's color, so card and tail read as one shape.
 */
function Tail({ side, at }: { side: TailSide; at: number }){
    const across = side === "top" || side === "bottom";
    const length = TAIL_LENGTH + 1;
    // placed from the card's padding box, 1 px in from its border box, so its base covers the border
    const style: CSSProperties = side === "bottom" ? { left: at - TAIL_BASE / 2 - 1, top: "100%" }
        : side === "top" ? { left: at - TAIL_BASE / 2 - 1, bottom: "100%" }
        : side === "right" ? { top: at - TAIL_BASE / 2 - 1, left: "100%" }
        : { top: at - TAIL_BASE / 2 - 1, right: "100%" };
    const d = side === "bottom" ? `M 0 0 L ${TAIL_BASE / 2} ${length} L ${TAIL_BASE} 0`
        : side === "top" ? `M 0 ${length} L ${TAIL_BASE / 2} 0 L ${TAIL_BASE} ${length}`
        : side === "right" ? `M 0 0 L ${length} ${TAIL_BASE / 2} L 0 ${TAIL_BASE}`
        : `M ${length} 0 L 0 ${TAIL_BASE / 2} L ${length} ${TAIL_BASE}`;
    return (
        <svg aria-hidden data-tail={side} width={across ? TAIL_BASE : length} height={across ? length : TAIL_BASE} style={style} className="absolute overflow-visible fill-panel stroke-border">
            <path d={d} strokeWidth={1} strokeLinejoin="round" />
        </svg>
    );
}
