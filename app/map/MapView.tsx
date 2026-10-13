"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { LevelResponse, LiveEvent } from "@/lib/contracts";
import { api, ApiError } from "./api";
import Breadcrumb from "./Breadcrumb";
import DetailPanel, { PANEL_WIDTH } from "./DetailPanel";
import HelpDialog from "./HelpDialog";
import ActivityBar from "./ActivityBar";
import { AGENT_ACTIVE_MS, agentFocus } from "./activity";
import MapCanvas from "./MapCanvas";
import { mapUrl, placeFromSearch, type MapPlace } from "./history";
import { boxFor, parentOf } from "./paths";
import { markStart, measureAfterPaint } from "./perf";
import { pageNote } from "./portals";
import { mapShortcut } from "./shortcuts";
import { nextPulses, type Pulse } from "./pulses";
import RepoMenu from "./RepoMenu";
import SearchPalette from "./SearchPalette";
import StatusPill from "./StatusPill";
import TopBar from "./TopBar";
import { useIndexStatus } from "./useIndexStatus";
import { useLive } from "./useLive";

/**
 * Levels fetched for one repo and index version (ADR-036), by folder and page: going back up a level is instant until
 * the index moves.
 */
type LevelCache = { repo: string; version: number; levels: ReadonlyMap<string, LevelResponse> };
/** Set once the help has opened by itself, so it does so only on a first visit. */
const HELP_SEEN = "nebulosity.helpSeen";

const cacheKey = (place: MapPlace): string => `${place.path}\0${place.page}`;

/** The cache with one more level in it: the same repo and version keep what's there, anything newer starts over. */
const cacheWith = (cache: LevelCache | null, place: MapPlace, level: LevelResponse): LevelCache => ({
    repo: level.repo,
    version: level.indexVersion,
    levels: new Map(cache !== null && cache.repo === level.repo && cache.version === level.indexVersion ? cache.levels : []).set(cacheKey(place), level),
});

/** The Map (PIVOT_SPEC.md §7): the page's one client component. */
export default function MapView(){
    return (
        <ReactFlowProvider>
            <MapScreen />
        </ReactFlowProvider>
    );
}

function MapScreen(){
    const { status, error: statusError, refresh } = useIndexStatus();
    // where the Map is: read from the address bar on load, so a reload or a pasted link opens the same place (history.ts)
    const [place, setPlace] = useState<MapPlace>(() => (typeof window === "undefined" ? { path: "", page: 0 } : placeFromSearch(window.location.search)));
    const levelPath = place.path;
    const [cache, setCache] = useState<LevelCache | null>(null);
    const [levelError, setLevelError] = useState<ApiError | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    // a path to show that may be on another page: the server says which page holds it (focus(), below)
    const [focusing, setFocusing] = useState<string | null>(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [highlights, setHighlights] = useState<readonly string[]>([]);
    const [pulses, setPulses] = useState<ReadonlyMap<string, Pulse>>(new Map());

    const repo = status?.repo ?? null;
    const version = status?.indexVersion ?? null;
    // the level on screen: the one asked for, from this repo. While a newer version loads, the older copy stays up.
    const level = cache !== null && cache.repo === repo ? cache.levels.get(cacheKey(place)) ?? null : null;
    const current = cache !== null && cache.repo === repo && cache.version === version && cache.levels.has(cacheKey(place));

    useEffect(() => {
        if (repo === null || version === null || current) return;
        const controller = new AbortController();
        api.level(place.path, place.page, controller.signal).then(
            (next) => {
                setCache((c) => cacheWith(c, place, next));
                setLevelError(null);
            },
            (err: unknown) => { if (err instanceof ApiError) setLevelError(err); },
        );
        return () => controller.abort();
    }, [repo, version, place, current]);

    // Showing a path on a big folder's other page: the level is fetched with `focus`, and the server answers with the
    // page holding it. The place moves once, to that page, so Back has one step to undo, not a page-0 stop on the way.
    useEffect(() => {
        if (focusing === null || repo === null) return;
        const controller = new AbortController();
        api.level(parentOf(focusing), 0, controller.signal, focusing).then(
            (next) => {
                const at = { path: next.path, page: next.page };
                setCache((c) => cacheWith(c, at, next));
                setPlace(at);
                setSelected(focusing);
                setFocusing(null);
                setLevelError(null);
            },
            (err: unknown) => {
                if (!(err instanceof ApiError)) return;
                setLevelError(err);
                setFocusing(null);
            },
        );
        return () => controller.abort();
    }, [focusing, repo]);

    // Every move to another folder or page goes into the browser's history, so Back returns to the previous one
    // (owner review). Back itself only reads the address bar: the place it sets already matches, so nothing is pushed.
    useEffect(() => {
        const url = mapUrl(place.path, place.page);
        if (window.location.pathname + window.location.search !== url) window.history.pushState(null, "", url);
    }, [place]);
    useEffect(() => {
        const onPop = (): void => {
            markStart("map:level");
            setPlace(placeFromSearch(window.location.search));
            setSelected(null);
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    /**
     * Opens a folder's level, the Map's main move. The timing mark goes down only when the level changes: the canvas
     * reports a draw only then, and a mark nobody measures would be read at the next level change as one long one.
     */
    const open = useCallback((folder: string) => {
        if (folder !== levelPath) markStart("map:level");
        setPlace({ path: folder, page: 0 });
        setSelected(null);
        setFocusing(null);
    }, [levelPath]);

    /** Another page of a big folder: the arrows, ← and →, or a portal (owner review: every box is drawn on some page). */
    const turnPage = useCallback((page: number) => {
        markStart("map:level");
        setPlace({ path: levelPath, page });
        setSelected(null);
        setFocusing(null);
    }, [levelPath]);

    const select = useCallback((target: string | null) => {
        if (target !== null) markStart("map:select");
        setSelected(target);
    }, []);

    /**
     * Goes to the level and page that hold a path and selects it there: search results, the panel's links, focus_node.
     * A box already drawn is just selected; anything else may sit on another page of a big folder, so the server finds
     * the page (the effect above).
     */
    const focus = useCallback((target: string) => {
        if (target === ""){
            open("");
            return;
        }
        // a box on the page already showing is a selection; anything else is timed as a new level (open() says why)
        if (parentOf(target) === levelPath && level?.nodes.some((n) => n.path === target)){
            markStart("map:select");
            setSelected(target);
            return;
        }
        markStart("map:level");
        setFocusing(target);
    }, [open, levelPath, level]);


    /** A tool call from Claude Code (PIVOT_SPEC.md §8): pulse the boxes it touched, and run its UI action. */
    const onLive = useCallback((event: LiveEvent) => {
        if (level !== null){
            const boxes = event.paths.flatMap((p) => boxFor(level, p) ?? []);
            setPulses((state) => nextPulses(state, boxes, Date.now()));
        }
        const action = event.action;
        if (action?.type === "highlight_nodes") setHighlights(action.nodeIds);
        else if (action?.type === "clear_highlights") setHighlights([]);
        else if (action?.type === "focus_node") focus(action.nodeId);
    }, [level, focus]);
    const live = useLive(onLive);

    // A clock for Claude's focus: it ticks each second only while the newest tool call is under AGENT_ACTIVE_MS old,
    // so the orange rings let go on time and an idle Map doesn't re-render. Reading Date.now() during render isn't
    // allowed, so the time lives in state.
    const [now, setNow] = useState(0);
    const newest = live.recent[0]?.at ?? null;
    useEffect(() => {
        if (newest === null) return;
        const timer = setInterval(() => {
            const t = Date.now();
            setNow(t);
            if (t - Date.parse(newest) >= AGENT_ACTIVE_MS) clearInterval(timer);
        }, 1_000);
        return () => clearInterval(timer);
    }, [newest]);

    // Claude's focus (VISUAL_REFRESH.md §4): the boxes its recent tool calls touched, and show_on_map's highlights. Kept
    // by content, so the canvas only redraws when the set itself changes, not on every tick.
    const agentKey = level === null ? "" : [...agentFocus(level, live.recent, highlights, now)].sort().join("\0");
    const agent = useMemo(() => new Set(agentKey === "" ? [] : agentKey.split("\0")), [agentKey]);

    const onSwitched = useCallback(() => {
        setPlace({ path: "", page: 0 });
        setSelected(null);
        setHighlights([]);
        refresh();
    }, [refresh]);

    const onDrawn = useCallback(() => measureAfterPaint("map:level"), []);
    const closeHelp = useCallback(() => setHelpOpen(false), []);

    // The help opens by itself the first time this browser opens the Map (owner review). A browser that keeps no
    // storage (a private window) just doesn't get it unasked; the ? button still works.
    useEffect(() => {
        const timer = setTimeout(() => {
            try{
                if (window.localStorage.getItem(HELP_SEEN) !== null) return;
                window.localStorage.setItem(HELP_SEEN, "1");
                setHelpOpen(true);
            } catch{
                // no storage: nothing to remember the first visit by
            }
        }, 0);
        return () => clearTimeout(timer);
    }, []);
    const closePanel = useCallback(() => setSelected(null), []);

    // Escape lets go of the selection, Backspace goes up a level, the arrow keys turn the page, unless the user is typing
    // or a dialog is open over the Map (shortcuts.ts)
    const page = level?.page ?? 0;
    const pageCount = level?.pageCount ?? 1;
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const shortcut = mapShortcut(event, {
                typing: event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName),
                // the dialogs render into the page's body (portals), so the page itself says whether one is open
                dialogOpen: document.querySelector('[role="dialog"]') !== null,
                levelPath,
                page,
                pageCount,
            });
            if (shortcut === null) return;
            if (shortcut.type === "search"){
                event.preventDefault();
                setPaletteOpen(true);
            } else if (shortcut.type === "help") setHelpOpen(true);
            else if (shortcut.type === "deselect") setSelected(null);
            else if (shortcut.type === "up") open(parentOf(levelPath));
            else turnPage(shortcut.page);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [levelPath, open, page, pageCount, turnPage]);

    if (statusError?.code === "INDEX_EMPTY") return <EmptyState />;

    return (
        <div className="absolute inset-0 flex flex-col">
            <TopBar
                repo={repo ? <RepoMenu repo={repo} onSwitched={onSwitched} /> : null}
                onSearch={() => setPaletteOpen(true)}
                status={<StatusPill status={status} />}
                onHelp={() => setHelpOpen(true)}
            />
            <div className="pointer-events-auto relative z-10 flex h-10 items-center justify-between gap-4 border-b border-hairline bg-canvas px-4">
                {level && repo ? <Breadcrumb repo={repo} trail={level.breadcrumb} onOpen={open} /> : <span />}
                {level && level.hiddenCount > 0 && <span data-testid="page-note" className="shrink-0 text-[12px] text-text-2">{pageNote(level)}</span>}
            </div>
            <main className="relative flex-1">
                {level && (
                    <MapCanvas
                        level={level}
                        selected={selected}
                        agent={agent}
                        pulses={pulses}
                        onSelect={select}
                        onOpen={open}
                        onTurnPage={turnPage}
                        onDrawn={onDrawn}
                    />
                )}
                {level && pageCount > 1 && (
                    <>
                        {page > 0 && <PageArrow side="left" page={page} pageCount={pageCount} onTurn={turnPage} />}
                        {page < pageCount - 1 && <PageArrow side="right" page={page} pageCount={pageCount} onTurn={turnPage} panelOpen={selected !== null} />}
                    </>
                )}
                {!level && !levelError && <p className="absolute inset-0 grid place-items-center text-[13px] text-text-2">Loading the map…</p>}
                {levelError && <p className="absolute inset-x-0 top-6 text-center text-[13px] text-danger">{levelError.message}</p>}
                {selected !== null && level && (
                    <DetailPanel
                        key={selected}
                        path={selected}
                        level={level}
                        indexVersion={version ?? 0}
                        onFocus={focus}
                        onOpen={open}
                        onTurnPage={turnPage}
                        onClose={closePanel}
                    />
                )}
            </main>
            <ActivityBar recent={live.recent} connected={live.connected} />
            {helpOpen && <HelpDialog onClose={closeHelp} />}
            {paletteOpen && (
                <SearchPalette
                    onPick={(hit) => {
                        setPaletteOpen(false);
                        focus(hit.path);
                    }}
                    onClose={() => setPaletteOpen(false)}
                />
            )}
        </div>
    );
}

type PageArrowProps = { side: "left" | "right"; page: number; pageCount: number; onTurn: (page: number) => void; panelOpen?: boolean };

/** A big arrow on the canvas's edge that turns to the previous or next page of boxes (owner review). */
function PageArrow({ side, page, pageCount, onTurn, panelOpen = false }: PageArrowProps){
    const next = side === "left" ? page - 1 : page + 1;
    const Icon = side === "left" ? IconChevronLeft : IconChevronRight;
    const word = side === "left" ? "Previous" : "Next";
    return (
        <button
            type="button"
            data-testid={`page-${side === "left" ? "previous" : "next"}`}
            onClick={() => onTurn(next)}
            aria-label={`${word} boxes: page ${next + 1} of ${pageCount}`}
            title={`${word} boxes (${side === "left" ? "Left" : "Right"} arrow key)`}
            style={side === "right" ? { right: (panelOpen ? PANEL_WIDTH : 0) + 16 } : { left: 16 }}
            className="absolute top-1/2 z-[6] grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface text-text-2 hover:border-text-2 hover:text-text"
        >
            <Icon aria-hidden size={24} stroke={1.75} />
        </button>
    );
}

function EmptyState(){
    return (
        <div className="absolute inset-0 grid place-items-center">
            <div className="max-w-md space-y-2 text-center text-[14px] text-text-2">
                <p className="text-[15px] font-medium text-text">No repository indexed yet.</p>
                <p>Index one from a terminal, then reload: <code className="rounded-md bg-code-bg px-1 font-mono text-[13px] text-code">npm run index -- &lt;path-to-repo&gt;</code></p>
            </div>
        </div>
    );
}
