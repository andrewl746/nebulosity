"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { useReactFlow } from "@xyflow/react";
import { IconCheck, IconChevronLeft, IconChevronRight, IconDots } from "@tabler/icons-react";
import type { LevelResponse } from "@/lib/contracts";
import { formatCount } from "./format";
import { heaviestLink } from "./labels";
import { FIT_PADDING } from "./levelLayout";
import { placePopover, usePlaceOnResize } from "./popover";
import { pageNote } from "./portals";
import { useDismiss } from "./useDismiss";

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
};

/** The fit button's fit: the whole level with room around it, never past 100% (VISUAL_REFRESH.md §4). */
const FIT = { padding: FIT_PADDING, maxZoom: 1, duration: 0 } as const;
const MENU_WIDTH = 220;
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
 * Show all lines). On its right a big folder's page control, Strong links only, and zoom − + Fit.
 *
 * As the canvas narrows the toolbar gives way in a fixed order and nothing hides off its edge (the owner, 2026-10-27):
 * the finding truncates, then goes under a 500 px canvas; Strong links only moves into a … menu at its end under 470,
 * then − and + under 330; the page control says "2 / 5" under 400 and moves into the menu under 260. Over the canvas
 * Fit always stays. In a short window the toolbar folds into the header's row, keeping the page control, Fit and the
 * menu, and in a window under 480 px wide only the menu, which then holds the page control and Fit too (the breadcrumb
 * needs the room), and under 360 the search.
 */
export default function MapToolbar({ level, strongOnly, onStrongOnly, busy, showAllLines, onShowAllLines, onTurnPage, canvasWidth, inHeader, narrow, helpInMenu, onHelp, searchInMenu, onSearch }: MapToolbarProps){
    const flow = useReactFlow();
    const strongInBar = !inHeader && canvasWidth >= 470;
    const zoomInBar = !inHeader && canvasWidth >= 330;
    const findingShown = !inHeader && canvasWidth >= 500;
    // a big folder's page control, until even "2 / 5" and its arrows leave no room for Fit and the menu
    const paged = level.pageCount > 1;
    const menuOnly = inHeader && narrow;
    const pageInBar = paged && canvasWidth >= 260 && !menuOnly;
    const finding = heaviestLink(level);

    const menu: { label: string; on?: boolean; disabled?: boolean; act: () => void }[] = [];
    if (searchInMenu) menu.push({ label: "Search files and concepts", act: onSearch });
    if (paged && !pageInBar){
        menu.push(
            { label: `Previous page (${level.page + 1} of ${level.pageCount})`, disabled: level.page === 0, act: () => onTurnPage(level.page - 1) },
            { label: "Next page", disabled: level.page >= level.pageCount - 1, act: () => onTurnPage(level.page + 1) },
        );
    }
    if (menuOnly) menu.push({ label: "Show the whole level", act: () => void flow.fitView(FIT) });
    if (!strongInBar) menu.push({ label: "Strong links only", on: strongOnly, act: () => onStrongOnly(!strongOnly) });
    if (busy && (inHeader || !findingShown)) menu.push({ label: "Show all lines", on: showAllLines, act: () => onShowAllLines(!showAllLines) });
    if (!zoomInBar) menu.push({ label: "Zoom in", act: () => void flow.zoomIn({ duration: 0 }) }, { label: "Zoom out", act: () => void flow.zoomOut({ duration: 0 }) });
    if (helpInMenu) menu.push({ label: "How to use the Map", act: onHelp });

    const controls: ReactNode = (
        <div className="flex shrink-0 items-center gap-1.5">
            {pageInBar && <PageControl level={level} onTurn={onTurnPage} short={inHeader || canvasWidth < 400} />}
            {strongInBar && (
                <label title="Draw only the lines with at least 2% of the heaviest line's imports, and every line of the box you select or hover" className="mr-1 flex cursor-pointer items-center gap-[7px] rounded-[4px] text-[13px] text-text-2 hover:text-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus">
                    <input type="checkbox" data-testid="strong-only" checked={strongOnly} onChange={(e) => onStrongOnly(e.target.checked)} className="sr-only" />
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
            {!menuOnly && <button type="button" data-testid="fit" onClick={() => void flow.fitView(FIT)} title="Show the whole level" className={BUTTON}>Fit</button>}
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

/** The … menu at the toolbar's end, holding whatever the bar has no room for, placed inside the window as it opens. */
function MoreMenu({ items }: { items: { label: string; on?: boolean; disabled?: boolean; act: () => void }[] }){
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<CSSProperties>({ right: 0, width: MENU_WIDTH });
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
    const placeMenu = useCallback(() => {
        if (ref.current) setPlace(placePopover(ref.current, MENU_WIDTH, "end"));
    }, [ref]);
    usePlaceOnResize(open, placeMenu);
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
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role={item.on === undefined ? "menuitem" : "menuitemcheckbox"}
                            aria-checked={item.on}
                            disabled={item.disabled}
                            onClick={() => {
                                item.act();
                                if (item.on === undefined) setOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-text-2 hover:bg-node hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-2"
                        >
                            {item.on !== undefined && <Check on={item.on} />}
                            {/* a narrow window narrows the menu, and a label cut short is whole in its title */}
                            <span title={item.label} className="truncate">{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
