"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { IconFile, IconFolder, IconX } from "@tabler/icons-react";
import type { LevelResponse } from "@/lib/contracts";
import { explorerView, rowTone, type ExplorerRow, type ExplorerView, type RowTone } from "./explorerRows";
import { formatCount } from "./format";
import { useDismiss } from "./useDismiss";

export type ExplorerProps = {
    /** The level on screen: its folders, files and doorways, its lines, and which page of it this is. */
    level: LevelResponse;
    /** The selected box's path, or null. */
    selected: string | null;
    /** The paths joined to the selection by a drawn line. */
    linked: ReadonlySet<string>;
    /** full is the 236 px list. rail is a 40 px column whose one button opens the list over the canvas. */
    form: "full" | "rail";
    /** A click on a row selects that box on the Map. */
    onSelect: (path: string) => void;
    /** A double click on a folder's row goes into it. */
    onOpen: (folder: string) => void;
};

/**
 * How long the rail's list stays open after a click on a row. The second click of a double click has to find the row
 * still there: closed at once, it would land on the canvas underneath and let go of the selection (the pane's click), or
 * open whatever box sits under the pointer.
 */
const DOUBLE_CLICK_WAIT = 350;   // ms

const ROW_TONE: Record<RowTone, string> = {
    selected: "bg-row-sel text-text",
    linked: "text-text hover:bg-node",
    plain: "text-text-2 hover:bg-node",
};
const BAR_TONE: Record<RowTone, string> = { selected: "bg-accent", linked: "bg-linked-glyph", plain: "bg-glyph-dim" };

const rowOf = (list: HTMLElement, path: string): HTMLElement | null => list.querySelector<HTMLElement>(`[data-explorer-row="${CSS.escape(path)}"]`);

/**
 * Scrolls the list just far enough to show the selected row, the way VS Code's explorer follows the editor: a box
 * selected on the Map may sit far down a long list. Only the list moves. scrollIntoView would scroll every ancestor
 * that can, the page among them, and the page must never scroll.
 */
function reveal(list: HTMLElement | null, path: string | null): void {
    const row = list !== null && path !== null ? rowOf(list, path) : null;
    if (list === null || row === null) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/** "Explorer" and how many items, over the list. The rail's list adds its close button at the end. */
function Header({ count, tall, children }: { count: string; tall?: boolean; children?: ReactNode }){
    return (
        <div className={`flex shrink-0 items-center justify-between gap-2 pl-[14px] text-[11.5px] text-text-3 ${tall ? "h-10 pr-2" : "h-[34px] pr-[14px]"}`}>
            <span className="truncate">Explorer</span>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{count}{children}</span>
        </div>
    );
}

/**
 * One row, a real button: the icon, the name in mono, and for a folder its bar and how many files it holds. The whole
 * path is its title, since a long name is cut short with an ellipsis. The focus ring is drawn inside, where the list's
 * edges can't clip it.
 */
function Row({ row, tone, onPick, onOpen }: {
    row: ExplorerRow;
    tone: RowTone;
    onPick: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
    onOpen: (folder: string) => void;
}){
    const folder = row.kind === "folder";
    const Icon = folder ? IconFolder : IconFile;
    return (
        <li>
            <button
                type="button"
                data-explorer-row={row.path}
                aria-current={tone === "selected" ? "true" : undefined}
                aria-label={folder ? row.label : undefined}
                title={row.path}
                onClick={(event) => onPick(row.path, event)}
                onDoubleClick={folder ? () => onOpen(row.path) : undefined}
                className={`grid h-[26px] w-full grid-cols-[16px_minmax(0,1fr)_36px_minmax(44px,max-content)] items-center gap-2 pl-[14px] pr-3 text-left focus-visible:-outline-offset-2 ${ROW_TONE[tone]}`}
            >
                <Icon aria-hidden size={14} stroke={1.75} className="text-text-3" />
                <span className={`truncate font-mono text-[12.5px] ${folder ? "" : "col-span-3"}`}>{row.name}</span>
                {folder && (
                    <>
                        <span aria-hidden className={`h-[3px] rounded-[2px] ${BAR_TONE[tone]}`} style={{ width: row.bar }} />
                        <span className="whitespace-nowrap text-right text-[11.5px] tabular-nums text-text-3">{formatCount(row.files)}</span>
                    </>
                )}
            </button>
        </li>
    );
}

type RowsProps = {
    view: ExplorerView;
    selected: string | null;
    linked: ReadonlySet<string>;
    onPick: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
    onOpen: (folder: string) => void;
};

/**
 * The rows, scrolling inside when there are more than fit, and under them, for a folder drawn a page at a time, which
 * page this is. It keeps the selected row in view as the selection changes.
 */
function Rows({ view, selected, linked, onPick, onOpen }: RowsProps){
    const list = useRef<HTMLDivElement>(null);
    useEffect(() => reveal(list.current, selected), [selected, view]);

    return (
        <div ref={list} className="relative min-h-0 flex-1 overflow-y-auto pb-[10px]">
            <ul aria-label="Folders and files">
                {view.rows.map((row) => <Row key={row.path} row={row} tone={rowTone(row.path, selected, linked)} onPick={onPick} onOpen={onOpen} />)}
            </ul>
            {view.pageLine !== null && <p className="px-[14px] pt-2 text-[11.5px] leading-4 text-text-3">{view.pageLine}</p>}
        </div>
    );
}

/**
 * The list over the canvas, from the rail's right edge. It's a dialog, so the Map's own keys (Escape, Backspace, the
 * arrows) wait while it's open (MapView asks the page whether one is). The focus goes to the selected row, or the first,
 * so the keyboard can carry on from the button that opened it.
 */
function Overlay({ id, view, selected, linked, onPick, onOpen, onClose }: RowsProps & { id: string; onClose: () => void }){
    const self = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const dialog = self.current;
        const row = dialog?.querySelector<HTMLElement>('[aria-current="true"]') ?? dialog?.querySelector<HTMLElement>("[data-explorer-row]");
        // the list has already scrolled to the selection (Rows), so the focus mustn't scroll anything again
        row?.focus({ preventScroll: true });
    }, []);

    return (
        <div
            ref={self}
            id={id}
            role="dialog"
            aria-label="Explorer"
            className="absolute bottom-0 left-full top-0 z-20 flex w-[236px] max-w-[calc(100vw_-_48px)] flex-col border-r border-divider bg-panel"
        >
            <Header count={view.count} tall>
                <button type="button" onClick={onClose} aria-label="Close the explorer" className="grid h-6 w-6 place-items-center rounded-md text-text-2 hover:bg-node hover:text-text">
                    <IconX aria-hidden size={16} stroke={1.75} />
                </button>
            </Header>
            <Rows view={view} selected={selected} linked={linked} onPick={onPick} onOpen={onOpen} />
        </div>
    );
}

/**
 * The explorer as a 40 px rail, for a window too narrow to keep the whole list beside the canvas: one button that opens
 * the list over the canvas. Escape, the ×, a click outside or the focus moving away closes it. A click on a row selects
 * that box and closes it a moment later, so a double click still opens a folder (DOUBLE_CLICK_WAIT). The keyboard's
 * Enter has no second click to wait for, so it closes at once.
 */
function Rail({ view, selected, linked, onSelect, onOpen }: Omit<RowsProps, "onPick" | "onOpen"> & Pick<ExplorerProps, "onSelect" | "onOpen">){
    const [open, setOpen] = useState(false);
    // bumped by each click on a row: the list closes DOUBLE_CLICK_WAIT after the last
    const [picks, setPicks] = useState(0);
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);

    /** Closes the list without moving the focus: a click outside, or the focus already gone elsewhere. */
    const dismiss = useCallback((): void => {
        setOpen(false);
        setPicks(0);
    }, []);
    const root = useDismiss<HTMLElement>(open, dismiss);
    /** Closes the list, the focus going back to the rail's button when it was in the list, rather than to the page. */
    const close = useCallback((): void => {
        if (root.current?.contains(document.activeElement)) button.current?.focus();
        dismiss();
    }, [dismiss, root]);

    useEffect(() => {
        if (picks === 0) return;
        const timer = setTimeout(close, DOUBLE_CLICK_WAIT);
        return () => clearTimeout(timer);
    }, [picks, close]);

    // Escape closes just the list. Caught first, on the way down, and stopped there, so it doesn't also reach the Map's
    // Escape, which would let go of the selection the moment the list is gone
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            close();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open, close]);

    const pick = (path: string, event: MouseEvent<HTMLButtonElement>): void => {
        onSelect(path);
        // a click's detail counts its clicks, and Enter or Space on the row gives 0
        if (event.detail === 0) close();
        else setPicks((n) => n + 1);
    };
    const openFolder = (folder: string): void => {
        onOpen(folder);
        close();
    };

    return (
        <aside
            ref={root}
            aria-label="Explorer"
            onBlur={(event) => {
                // the focus left for something outside (Tab past the last row, the search box opening): close behind it
                if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) dismiss();
            }}
            className="relative flex h-full w-full flex-col items-center border-r border-divider bg-panel pt-1.5"
        >
            <button
                ref={button}
                type="button"
                aria-label="Open the explorer"
                title="Explorer"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => (open ? close() : setOpen(true))}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-[5px] ${open ? "bg-node text-text" : "text-text-2 hover:bg-node hover:text-text"}`}
            >
                <IconFolder aria-hidden size={18} stroke={1.75} />
            </button>
            {open && (
                <Overlay id={id} view={view} selected={selected} linked={linked} onPick={pick} onOpen={openFolder} onClose={close} />
            )}
        </aside>
    );
}

/**
 * The explorer (the Workbench redesign, ADR-070): the boxes of the level on screen as a list beside the canvas, the
 * browser's answer to VS Code's own side bar, which the panel inside VS Code has instead. Folders come first, the
 * largest at the top, each with a bar on the same log scale as its dot and how many files it holds, then the files by
 * name. Doorways to other pages aren't rows, and a folder drawn a page at a time says which page under the list. The rows
 * follow the Map: the selection's row is filled, and what's joined to it by a line is brighter with a lilac bar. A click
 * selects that box on the Map, and a double click on a folder goes into it. In a narrower window it's a 40 px rail
 * whose button opens the same list over the canvas. It fills its parent's height, scrolling inside, and the parent sets
 * its width.
 */
function Explorer({ level, selected, linked, form, onSelect, onOpen }: ExplorerProps){
    const view = useMemo(() => explorerView(level), [level]);

    if (form === "rail") return <Rail view={view} selected={selected} linked={linked} onSelect={onSelect} onOpen={onOpen} />;
    return (
        <aside aria-label="Explorer" className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-divider bg-panel">
            <Header count={view.count} />
            <Rows view={view} selected={selected} linked={linked} onPick={(path) => onSelect(path)} onOpen={onOpen} />
        </aside>
    );
}

// memo: the list draws again only when its own props change, not with everything else MapView redraws
export default memo(Explorer);
