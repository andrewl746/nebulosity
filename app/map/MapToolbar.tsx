"use client";

import { useCallback, useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { IconCheck, IconChevronLeft, IconChevronRight, IconDots } from "@tabler/icons-react";
import type { LevelResponse } from "@/lib/contracts";
import { formatCount } from "./format";
import { heaviestLink } from "./labels";
import type { BoxNode } from "./MapBox";
import { placePopover, usePlaceOnResize } from "./popover";
import { pageNote } from "./portals";
import type { RoutedEdgeType } from "./RoutedEdge";
import { weakLinesHidden, type LineDirection } from "./emphasis";
import { useDismiss } from "./useDismiss";
import { boundsOf, fitViewport, linesBounds } from "./viewport";
import { arrowHead } from "./weights";

type MapToolbarProps = {
    level: LevelResponse;
    strongOnly: boolean;
    onStrongOnly: (on: boolean) => void;
    /** A busy level draws lines on hover only (emphasis.ts), unless all are asked for. */
    busy: boolean;
    showAllLines: boolean;
    onShowAllLines: (all: boolean) => void;
    onTurnPage: (page: number) => void;
    /** The canvas's width, which the toolbar's steps go by (shell.ts). */
    canvasWidth: number;
    /** Folded into the header's row in a short window (shell.ts): only the page control, Fit and the … menu show. */
    inHeader: boolean;
    /** A window under 480 px wide: folded into the header, the toolbar is only its … menu, the page control and Fit in it. */
    narrow: boolean;
    /** Help goes into the … menu where the header has no help button (VS Code's panel, a phone). */
    helpInMenu: boolean;
    onHelp: () => void;
    /** Search goes into the … menu where the header has no room left for its icon (a short window under 360 px). */
    searchInMenu: boolean;
    onSearch: () => void;
    /** A box is selected, so a side of its lines can be picked: All, Uses and Used by are greyed out until one is. */
    hasSelection: boolean;
    /** Which side of the selection's lines is highlighted (emphasis.ts). */
    direction: LineDirection;
    onDirection: (direction: LineDirection) => void;
    /** The sides of the selection with no line on the page, greyed out (emphasis.ts's sidesWithoutLines). */
    emptySides: readonly LineDirection[];
};

const MENU_WIDTH = 220;
/** The least canvas the side picker keeps its place in the bar at, before it goes into the … menu. */
const SIDES_IN_BAR = 600;

/**
 * The three sides, in the inspector's own words, each with its title and, for Uses and Used by, the color of the
 * underline its tab gets in the inspector, which is its lines' color on the Map.
 */
const SIDES: { id: LineDirection; label: string; title: string; mark?: string; dot: string }[] = [
    { id: "all", label: "All", title: "Highlight every line of the selected box", dot: "bg-text" },
    { id: "uses", label: "Uses", title: "Highlight only its lines to what it uses, the rest in gray", mark: "bg-accent", dot: "bg-accent" },
    { id: "usedBy", label: "Used by", title: "Highlight only its lines from what uses it, the rest in gray", mark: "bg-used-by-accent", dot: "bg-used-by-accent" },
];
const NO_SELECTION = "Select a box to choose which of its lines are highlighted";
const EMPTY_SIDE: Record<LineDirection, string> = {
    all: "",
    uses: "The selected box uses nothing on this page",
    usedBy: "Nothing on this page uses the selected box",
};
const BUTTON = "grid h-6 min-w-[26px] shrink-0 place-items-center rounded-[5px] border border-border px-2 text-[12.5px] text-text-2 hover:border-text-3 hover:text-text disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-2";

/** The checkbox of Strong links only, drawn in the accent when on. */
function Check({ on }: { on: boolean }){
    return (
        <span aria-hidden className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] ${on ? "bg-accent text-on-accent" : "border border-border"}`}>
            {on && <IconCheck size={11} stroke={3} />}
        </span>
    );
}

/**
 * The toolbar over the canvas (the Workbench redesign, ADR-070), 36 px. On its left a finding about the level, its
 * heaviest line and how much of the level's imports it carries (on a busy level, that its lines show on hover, with
 * Show all lines). On its right a big folder's page control, All, Uses and Used by for the selected box's lines (the
 * owner's pick A2, 2026-10-29, greyed out until a box is selected so nothing moves on a click), Strong links only, and
 * zoom − + Fit.
 *
 * As the canvas narrows the toolbar gives way in a fixed order and nothing hides off its edge (the owner, 2026-10-27):
 * the finding truncates (its title has the whole of it); All, Uses and Used by move into a … menu at its end under 600;
 * the finding goes under a 500 px canvas; Strong links only moves into the menu under 470, then − and + under 330; the
 * page control says "2 / 5" under 400 and moves into the menu under 260. Over the canvas Fit always stays. In a short
 * window the toolbar folds into the header's row, keeping the page control, Fit and the menu, and in a window under
 * 480 px wide only the menu, which then holds the page control and Fit too (the breadcrumb needs the room), and under
 * 360 the search.
 */
export default function MapToolbar({ level, strongOnly, onStrongOnly, busy, showAllLines, onShowAllLines, onTurnPage, canvasWidth, inHeader, narrow, helpInMenu, onHelp, searchInMenu, onSearch, hasSelection, direction, onDirection, emptySides }: MapToolbarProps){
    const flow = useReactFlow<BoxNode, RoutedEdgeType>();
    const store = useStoreApi<BoxNode, RoutedEdgeType>();
    // Fit: the whole level with room around it, never past 100% (VISUAL_REFRESH.md §4), and its drawn lines too unless
    // the boxes would shrink past 85% (viewport.ts). React Flow's fitView frames only the boxes, and a lane beside them
    // ran off under the inspector. A hidden line isn't handed to React Flow (MapCanvas), so these are the lines on screen
    const fit = () => {
        const boxes = boundsOf(new Map(flow.getNodes().map((node) => [node.id, node.position])));
        const lines = linesBounds(flow.getEdges().flatMap(({ data }) => data
            ? [{ points: data.points, width: data.width, headHalf: arrowHead(data.headWidth ?? data.width).half }]
            : []));
        const { width, height } = store.getState();
        void flow.setViewport(fitViewport(boxes, lines, { width, height }), { duration: 0 });
    };
    const sidesInBar = !inHeader && canvasWidth >= SIDES_IN_BAR;
    const strongInBar = !inHeader && canvasWidth >= 470;
    const zoomInBar = !inHeader && canvasWidth >= 330;
    const findingShown = !inHeader && canvasWidth >= 500;
    // a big folder's page control, until even "2 / 5" and its arrows leave no room for Fit and the menu
    const paged = level.pageCount > 1;
    const menuOnly = inHeader && narrow;
    const pageInBar = paged && canvasWidth >= 260 && !menuOnly;
    const finding = heaviestLink(level);
    // on a page where every line carries 2% of the heaviest's imports (any page whose heaviest is under 50), Strong
    // links only hides nothing, so it's greyed out with the reason in its title rather than a box that does nothing
    // (the owner, 2026-10-29, on VS Code's build). Greyed, not gone, so the toolbar keeps its shape from page to page
    const nothingWeak = weakLinesHidden(level.edges, null) === 0;
    const strongTitle = nothingWeak
        ? "Every line on this page carries at least 2% of the heaviest line's imports, so there's nothing to hide"
        : "Draw only the lines with at least 2% of the heaviest line's imports, and every line of the box you select or hover";

    const menu: MenuEntry[] = [];
    if (searchInMenu) menu.push({ label: "Search files and concepts", act: onSearch });
    if (paged && !pageInBar){
        menu.push(
            { label: `Previous page (${level.page + 1} of ${level.pageCount})`, disabled: level.page === 0, act: () => onTurnPage(level.page - 1) },
            { label: "Next page", disabled: level.page >= level.pageCount - 1, act: () => onTurnPage(level.page + 1) },
        );
    }
    if (menuOnly) menu.push({ label: "Show the whole level", act: fit });
    // folded into the menu, the three sides keep the bar's order and titles, under a heading that says whose lines
    if (!sidesInBar){
        menu.push({
            group: "Lines of the selected box",
            items: SIDES.map((side) => {
                const empty = emptySides.includes(side.id);
                return {
                    label: side.label, radio: true, on: direction === side.id, dot: side.dot,
                    disabled: !hasSelection || empty,
                    title: !hasSelection ? NO_SELECTION : empty ? EMPTY_SIDE[side.id] : side.title,
                    act: () => onDirection(side.id),
                };
            }),
        });
    }
    if (!strongInBar) menu.push({ label: "Strong links only", on: strongOnly, disabled: nothingWeak, title: strongTitle, act: () => onStrongOnly(!strongOnly) });
    if (busy && (inHeader || !findingShown)) menu.push({ label: "Show all lines", on: showAllLines, act: () => onShowAllLines(!showAllLines) });
    if (!zoomInBar) menu.push({ label: "Zoom in", act: () => void flow.zoomIn({ duration: 0 }) }, { label: "Zoom out", act: () => void flow.zoomOut({ duration: 0 }) });
    if (helpInMenu) menu.push({ label: "How to use the Map", act: onHelp });

    const controls: ReactNode = (
        <div className="flex shrink-0 items-center gap-1.5">
            {pageInBar && <PageControl level={level} onTurn={onTurnPage} short={inHeader || canvasWidth < 400} />}
            {sidesInBar && <SidePicker direction={direction} onDirection={onDirection} hasSelection={hasSelection} emptySides={emptySides} />}
            {strongInBar && (
                <label title={strongTitle} className={`mr-1 flex items-center gap-[7px] rounded-[4px] text-[13px] text-text-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${nothingWeak ? "cursor-default opacity-40" : "cursor-pointer hover:text-text"}`}>
                    <input type="checkbox" data-testid="strong-only" checked={strongOnly} disabled={nothingWeak} onChange={(e) => onStrongOnly(e.target.checked)} className="sr-only" />
                    <Check on={strongOnly} />
                    Strong links only
                </label>
            )}
            {zoomInBar && (
                <>
                    <button type="button" onClick={() => void flow.zoomOut({ duration: 0 })} aria-label="Zoom out" title="Zoom out" className={BUTTON}>−</button>
                    <button type="button" onClick={() => void flow.zoomIn({ duration: 0 })} aria-label="Zoom in" title="Zoom in" className={BUTTON}>+</button>
                </>
            )}
            {!menuOnly && <button type="button" data-testid="fit" onClick={fit} title="Show the whole level" className={BUTTON}>Fit</button>}
            {menu.length > 0 && <MoreMenu items={menu} />}
        </div>
    );
    if (inHeader) return controls;

    return (
        <div data-testid="toolbar" className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-divider pl-3.5 pr-2 text-[13px]">
            <div className="flex min-w-0 items-center gap-2 text-text-2">
                {findingShown && (busy
                    ? (
                        <span data-testid="lines-note" className="flex min-w-0 items-center gap-2">
                            {/* the title starts with the words, so a note cut short can still be read whole */}
                            <span className="truncate" title={showAllLines ? `All ${formatCount(level.edges.length)} lines shown` : "A busy folder, so lines show when you hover a box, or select it"}>{showAllLines ? `All ${formatCount(level.edges.length)} lines shown` : "A busy folder, so lines show when you hover a box"}</span>
                            <button type="button" data-testid="lines-toggle" onClick={() => onShowAllLines(!showAllLines)} className="shrink-0 text-text underline decoration-text-3 underline-offset-2 hover:decoration-text">
                                {showAllLines ? "Show on hover only" : "Show all lines"}
                            </button>
                        </span>
                    )
                    : finding && (
                        <span data-testid="finding" className="truncate" title={`Heaviest link is ${finding.from} → ${finding.to}, ${formatCount(finding.count)} of ${formatCount(finding.total)} imports between these boxes`}>
                            Heaviest link is <span className="font-mono text-[12.5px] text-text">{finding.from} → {finding.to}</span>, {formatCount(finding.count)} of {formatCount(finding.total)} imports
                        </span>
                    ))}
            </div>
            {controls}
        </div>
    );
}

/**
 * Which page of a big folder is on screen, with a button either side (← and → turn it too). "Page 2 of 5", or "2 / 5"
 * where room is short, the whole note in its title.
 */
function PageControl({ level, onTurn, short }: { level: LevelResponse; onTurn: (page: number) => void; short: boolean }){
    const step = (side: "left" | "right") => {
        const next = side === "left" ? level.page - 1 : level.page + 1;
        const Icon = side === "left" ? IconChevronLeft : IconChevronRight;
        return (
            <button
                type="button"
                data-testid={`page-${side === "left" ? "previous" : "next"}`}
                disabled={next < 0 || next >= level.pageCount}
                onClick={() => onTurn(next)}
                aria-label={`${side === "left" ? "Previous" : "Next"} page`}
                title={`${side === "left" ? "Previous" : "Next"} page (${side === "left" ? "←" : "→"})`}
                className={`${BUTTON} px-1`}
            >
                <Icon aria-hidden size={14} stroke={2} />
            </button>
        );
    };
    return (
        <span className="mr-1 flex items-center gap-1">
            {step("left")}
            <span data-testid="page-note" title={pageNote(level)} className="whitespace-nowrap px-1 text-[12.5px] text-text-2">
                {short ? `${level.page + 1} / ${level.pageCount}` : `Page ${level.page + 1} of ${level.pageCount}`}
            </span>
            {step("right")}
        </span>
    );
}

/**
 * All, Uses and Used by: which side of the selected box's lines is highlighted, the other drawn gray (emphasis.ts). A
 * radio group, so Tab lands only on the side picked and the arrow keys, Home and End move between the sides, skipping
 * one that can't be picked. Greyed out with nothing selected, and a side with no line on the page greyed out on its
 * own, each saying why in its title. The side picked is filled, Uses underlined in the accent and Used by in pink, as
 * their tabs are in the inspector.
 */
function SidePicker({ direction, onDirection, hasSelection, emptySides }: Pick<MapToolbarProps, "direction" | "onDirection" | "hasSelection" | "emptySides">){
    const open = SIDES.filter((side) => hasSelection && !emptySides.includes(side.id));
    const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
        const at = open.findIndex((side) => side.id === direction);
        const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? open[(at + 1) % open.length]
            : event.key === "ArrowLeft" || event.key === "ArrowUp" ? open[(at - 1 + open.length) % open.length]
            : event.key === "Home" ? open[0]
            : event.key === "End" ? open[open.length - 1]
            : undefined;
        if (next === undefined) return;
        // the Map's own ← and → turn the page: these keys are the picker's while one of its sides has the focus
        event.preventDefault();
        event.stopPropagation();
        onDirection(next.id);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-side="${next.id}"]`)?.focus();
    };
    return (
        <span
            role="radiogroup"
            aria-label="Lines of the selected box"
            data-testid="sides"
            title={hasSelection ? undefined : NO_SELECTION}
            onKeyDown={onKeyDown}
            className={`mr-1.5 flex h-6 shrink-0 items-stretch rounded-[5px] border border-border p-px text-[12.5px] ${hasSelection ? "" : "opacity-40"}`}
        >
            {SIDES.map((side) => {
                const on = side.id === direction;
                const empty = emptySides.includes(side.id);
                return (
                    <button
                        key={side.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-side={side.id}
                        disabled={!hasSelection || empty}
                        tabIndex={on ? 0 : -1}
                        title={!hasSelection ? NO_SELECTION : empty ? EMPTY_SIDE[side.id] : side.title}
                        onClick={() => onDirection(side.id)}
                        className={`relative whitespace-nowrap rounded-[4px] px-2 leading-none disabled:cursor-default ${on ? "bg-node text-text" : "text-text-2 hover:text-text disabled:hover:text-text-2"} ${empty && hasSelection ? "opacity-40" : ""}`}
                    >
                        {side.label}
                        {on && hasSelection && side.mark && <span aria-hidden className={`absolute inset-x-1.5 bottom-0 h-0.5 rounded-[1px] ${side.mark}`} />}
                    </button>
                );
            })}
        </span>
    );
}

/** A row of the … menu: a plain item, a checkbox (on), or one of a group's radios (radio). */
type MenuItem = { label: string; on?: boolean; radio?: boolean; dot?: string; disabled?: boolean; title?: string; act: () => void };
/** Items under a heading that names them, like All, Uses and Used by under "Lines of the selected box". */
type MenuGroup = { group: string; items: MenuItem[] };
type MenuEntry = MenuItem | MenuGroup;

/** A menu radio's circle, filled with its side's color when picked. */
function Radio({ on, dot }: { on: boolean; dot: string }){
    return (
        <span aria-hidden className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-border">
            {on && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        </span>
    );
}

/** The … menu at the toolbar's end, holding whatever the bar has no room for, placed inside the window as it opens. */
function MoreMenu({ items }: { items: MenuEntry[] }){
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<CSSProperties>({ right: 0, width: MENU_WIDTH });
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
    const placeMenu = useCallback(() => {
        if (ref.current) setPlace(placePopover(ref.current, MENU_WIDTH, "end"));
    }, [ref]);
    usePlaceOnResize(open, placeMenu);
    const groupId = useId();
    // a plain item closes the menu, a checkbox keeps it open to show what it did, and a radio closes it so the lines it
    // picked are in view (Escape would let go of the selection with it: MapView's keys hear it too)
    const row = (item: MenuItem) => (
        <button
            key={item.label}
            type="button"
            role={item.radio ? "menuitemradio" : item.on === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.on}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
                item.act();
                if (item.on === undefined || item.radio) setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-text-2 hover:bg-node hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-2"
        >
            {item.radio ? <Radio on={item.on ?? false} dot={item.dot ?? "bg-text"} /> : item.on !== undefined && <Check on={item.on} />}
            {/* a narrow window narrows the menu, and a label cut short is whole in its title */}
            <span title={item.label} className="truncate">{item.label}</span>
        </button>
    );
    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                data-testid="toolbar-more"
                aria-label="More"
                title="More"
                aria-expanded={open}
                onClick={() => {
                    if (!open) placeMenu();
                    setOpen((o) => !o);
                }}
                className={`${BUTTON} px-1`}
            >
                <IconDots aria-hidden size={14} stroke={2} />
            </button>
            {open && (
                <div role="menu" data-testid="toolbar-menu" data-covers style={place} className="absolute top-8 z-30 overflow-y-auto rounded-md border border-border bg-panel p-1 text-[13px]">
                    {items.map((entry, i) => "group" in entry
                        ? (
                            // a hairline sets it apart from the rows around it, where there are any
                            <div
                                key={entry.group}
                                role="group"
                                aria-labelledby={`${groupId}-${i}`}
                                className={`border-divider ${i > 0 ? "mt-1 border-t pt-1" : ""} ${i < items.length - 1 ? "mb-1 border-b pb-1" : ""}`}
                            >
                                <p id={`${groupId}-${i}`} title={entry.group} className="truncate px-2.5 pb-0.5 pt-1 text-[11.5px] text-text-3">{entry.group}</p>
                                {entry.items.map(row)}
                            </div>
                        )
                        : row(entry))}
                </div>
            )}
        </div>
    );
}
