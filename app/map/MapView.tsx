"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { BridgeFromMap, BridgeToMap, LevelResponse, LiveEvent } from "@/lib/contracts";
import { api, ApiError } from "./api";
import Breadcrumb from "./Breadcrumb";
import DetailPanel, { PANEL_WIDTH } from "./DetailPanel";
import HelpDialog from "./HelpDialog";
import ActivityBar from "./ActivityBar";
import { AGENT_ACTIVE_MS, agentFocus } from "./activity";
import { isBusyLevel } from "./emphasis";
import { formatCount } from "./format";
import MapCanvas from "./MapCanvas";
import { followStep, historyStep, mapUrl, placeFromSearch, type MapPlace } from "./history";
import { boxFor, parentOf } from "./paths";
import { clearStart, markStart, measureAfterPaint } from "./perf";
import { pageNote, selectionShown } from "./portals";
import { mapShortcut } from "./shortcuts";
import { nextPulses, type Pulse } from "./pulses";
import RepoMenu from "./RepoMenu";
import SearchPalette from "./SearchPalette";
import StatusPill from "./StatusPill";
import TopBar from "./TopBar";
import { EMBEDDED, useEditorBridge } from "./useEditorBridge";
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
/** How long a failed jump's message stays up when nothing else moves the Map. */
const FOCUS_ERROR_MS = 6_000;

/**
 * A jump to a path (focus(), below), and how it was asked for. The editor's `follow` rewrites the history entry rather
 * than pushing one, and the editor's jumps are `quiet`: a path the index doesn't hold changes nothing and says nothing
 * (API_CONTRACTS §20, V1.8 plan P5). Every other jump pushes and says when it fails.
 */
type Focusing = { target: string; history: "push" | "replace"; quiet: boolean };
type FocusOptions = { history?: "push" | "replace"; quiet?: boolean };

/** The level a `drawn` names: a repo's folder and page (the layout's row width doesn't make it another level). */
const drawnKey = (level: Pick<LevelResponse, "repo" | "path" | "page">): string => `${level.repo}\0${level.path}\0${level.page}`;

/** Runs `fn` after the frame that paints what was just committed (perf.ts's double frame); gives back a cancel. */
function afterPaint(fn: () => void): () => void {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(fn); });
    return () => cancelAnimationFrame(frame);
}

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
    // a jump that failed (search, a chip, focus_node), kept with where the Map was, so it shows only until the Map moves
    const [focusError, setFocusError] = useState<{ error: ApiError; place: string; selected: string | null } | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    // a path to show that may be on another page: the server says which page holds it (focus(), below)
    const [focusing, setFocusing] = useState<Focusing | null>(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    // Claude Code's highlights (show_on_map), which the activity bar counts and Clear and Esc let go of
    const [highlights, setHighlights] = useState<readonly string[]>([]);
    // the editor's (What depends, through the bridge), ringed alike but never shown as Claude's activity (ADR-062): only
    // the bridge's highlight and clear, and a repo switch, change them
    const [editorHighlights, setEditorHighlights] = useState<readonly string[]>([]);
    // Clear lets go of show_on_map's highlights and of the boxes the calls so far are still outlining
    const [clearedAt, setClearedAt] = useState(-Infinity);
    const clearHighlights = useCallback(() => {
        setHighlights([]);
        setClearedAt(Date.now());
    }, []);
    // a busy level draws only the hovered or selected box's lines, unless the user asks for all of them; the choice
    // holds across levels until it's turned off (owner, 2026-10-12)
    const [showAllLines, setShowAllLines] = useState(false);
    const [pulses, setPulses] = useState<ReadonlyMap<string, Pulse>>(new Map());

    // the focus effect's failure handler reads where the Map is when the answer comes back, not when it was asked, and
    // the editor's `drawn` reads it when it is posted
    const placeRef = useRef(place);
    const selectedRef = useRef(selected);
    useEffect(() => {
        placeRef.current = place;
        selectedRef.current = selected;
    }, [place, selected]);
    // How the next place change goes into the history: "replace" only for the one an editor's follow made. The focus
    // effect sets it just before that move, and the history effect resets it, so it is used once and never later.
    const historyMode = useRef<"push" | "replace">("push");

    const repo = status?.repo ?? null;
    const version = status?.indexVersion ?? null;
    // the level on screen: the one asked for, from this repo. While a newer version loads, the older copy stays up.
    const level = cache !== null && cache.repo === repo ? cache.levels.get(cacheKey(place)) ?? null : null;
    const current = cache !== null && cache.repo === repo && cache.version === version && cache.levels.has(cacheKey(place));
    // the level on screen, for the bridge's callbacks, which run outside a render
    const levelRef = useRef(level);
    useEffect(() => {
        levelRef.current = level;
    }, [level]);
    // the level the canvas last reported placed (onDrawn): a `drawn` names a level only once it is painted (V1.8 plan P1)
    const reportedLevel = useRef<string | null>(null);

    useEffect(() => {
        if (repo === null || version === null || current) return;
        const controller = new AbortController();
        api.level(place.path, place.page, controller.signal).then(
            (next) => {
                // a page past the last (?page=9 of a 3-page folder) is answered with the last one: the place and the
                // address bar follow the answer, rewritten rather than pushed, since nobody moved
                const at = { path: place.path, page: next.page };
                setCache((c) => cacheWith(c, at, next));
                if (next.page !== place.page){
                    window.history.replaceState(null, "", mapUrl(at.path, at.page, EMBEDDED));
                    setPlace(at);
                }
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
        api.level(parentOf(focusing.target), 0, controller.signal, focusing.target).then(
            (next) => {
                // the server ignores a focus that isn't on the level (API_CONTRACTS §11), so a file the index doesn't
                // hold (new, ignored) still gets its folder: the editor's jumps leave the Map where it is then
                if (focusing.quiet && !next.nodes.some((n) => n.path === focusing.target)){
                    // no level change comes of it, so its timing mark would be read at the next one
                    clearStart("map:level");
                    setFocusing(null);
                    return;
                }
                const at = { path: next.path, page: next.page };
                setCache((c) => cacheWith(c, at, next));
                historyMode.current = focusing.history;
                setPlace(at);
                setSelected(focusing.target);
                setFocusing(null);
                setLevelError(null);
            },
            (err: unknown) => {
                if (!(err instanceof ApiError)) return;
                // the Map stays where it was, quiet or not, so nothing will measure the jump's mark
                clearStart("map:level");
                // the Map on screen is still good: say so where the user is, not as a level error over it. The editor's
                // jumps say nothing (P5): a follow names whatever file is open, indexed or not
                if (!focusing.quiet) setFocusError({ error: err, place: cacheKey(placeRef.current), selected: selectedRef.current });
                setFocusing(null);
            },
        );
        return () => controller.abort();
    }, [focusing, repo]);
    // the jump's error goes by itself after a few seconds too
    useEffect(() => {
        if (focusError === null) return;
        const timer = setTimeout(() => setFocusError(null), FOCUS_ERROR_MS);
        return () => clearTimeout(timer);
    }, [focusError]);

    // Every move to another folder or page goes into the browser's history, so Back returns to the previous one
    // (owner review). Back itself only reads the address bar: the place it sets already matches, so nothing is pushed.
    // A link that names the same place another way (?path=src%2Fvs, ?page=1) is rewritten instead, so Back needs one
    // press (history.ts). Inside VS Code's panel the address keeps `embed=vscode` (P8), and a move an editor's follow
    // made rewrites the entry instead of pushing one, so switching tabs doesn't fill Back (followStep).
    useEffect(() => {
        const step = followStep(historyStep(window.location.pathname + window.location.search, place, EMBEDDED), historyMode.current);
        historyMode.current = "push";
        if (step === "push") window.history.pushState(null, "", mapUrl(place.path, place.page, EMBEDDED));
        else if (step === "replace") window.history.replaceState(null, "", mapUrl(place.path, place.page, EMBEDDED));
    }, [place]);
    useEffect(() => {
        const onPop = (): void => {
            markStart("map:level");
            setPlace(placeFromSearch(window.location.search));
            setSelected(null);
            setFocusing(null);   // a jump still on its way would otherwise land after Back and undo it
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

    /**
     * Goes to the level and page that hold a path and selects it there: search results, the panel's links, focus_node,
     * and the editor's follow and show (with their options; everything else pushes and says when it fails). A box
     * already drawn is just selected; anything else may sit on another page of a big folder, so the server finds the
     * page (the effect above).
     */
    const focus = useCallback((target: string, options: FocusOptions = {}) => {
        if (target === ""){
            open("");
            return;
        }
        // a box on the page already showing is a selection; anything else is timed as a new level (open() says why)
        if (parentOf(target) === levelPath && level?.nodes.some((n) => n.path === target)){
            markStart("map:select");
            setSelected(target);
            setFocusing(null);   // a jump still on its way would land after this one and undo it
            return;
        }
        markStart("map:level");
        setFocusing({ target, history: options.history ?? "push", quiet: options.quiet ?? false });
    }, [open, levelPath, level]);

    /**
     * What the editor asks for (API_CONTRACTS §20): `follow` when its active file changed, a deliberate `show`, and the
     * files to light. Only the Map's own clicks open files in the editor, so nothing here echoes back (V1.8 plan P10).
     */
    const onEditorMessage = useCallback((message: BridgeToMap) => {
        if (message.type === "nebulosity.follow") focus(message.path, { history: "replace", quiet: true });
        else if (message.type === "nebulosity.show") focus(message.path, { quiet: true });
        else if (message.type === "nebulosity.highlight") setEditorHighlights(message.paths);
        else if (message.type === "nebulosity.clear") setEditorHighlights([]);
    }, [focus]);

    /**
     * The `drawn` for the level on screen (API_CONTRACTS §20), or null while the level there isn't the one the canvas
     * last reported painted: then that level's own report is still to come, and a `drawn` now would run ahead of it.
     */
    const drawnNow = useCallback((): BridgeFromMap | null => {
        const shown = levelRef.current;
        if (shown === null || drawnKey(shown) !== reportedLevel.current) return null;
        return { type: "nebulosity.drawn", path: placeRef.current.path, page: placeRef.current.page, selected: selectedRef.current };
    }, []);

    // embedded in VS Code (V1.8): the editor bridge; null in a browser tab, where nothing listens or posts. Right after
    // each `ready` it posts drawnNow(), for a hello that lands after the level was drawn.
    const editor = useEditorBridge(onEditorMessage, drawnNow);

    /** A box clicked on the canvas. Inside VS Code's panel a file box also opens in the editor (design §4.4). */
    const select = useCallback((target: string | null) => {
        if (target !== null) markStart("map:select");
        setSelected(target);
        if (editor !== null && target !== null && level?.nodes.some((n) => n.path === target && n.kind === "file")){
            editor.post({ type: "nebulosity.open", path: target });
        }
    }, [editor, level]);

    /** A declaration picked in the panel, inside VS Code's panel: it opens at its line in the editor (design §4.4). */
    const openInEditor = useCallback((path: string, line?: number) => {
        editor?.post({ type: "nebulosity.open", path, ...(line === undefined ? {} : { line }) });
    }, [editor]);


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

    // Claude's focus (VISUAL_REFRESH.md §4): the boxes its recent tool calls touched, and show_on_map's highlights, with
    // the editor's ringed alike. Kept by content, so the canvas only redraws when the set itself changes, not on every
    // tick.
    const agentKey = level === null ? "" : [...agentFocus(level, live.recent, highlights, now, clearedAt, editorHighlights)].sort().join("\0");
    const agent = useMemo(() => new Set(agentKey === "" ? [] : agentKey.split("\0")), [agentKey]);

    const onSwitched = useCallback(() => {
        setPlace({ path: "", page: 0 });
        setSelected(null);
        setFocusing(null);
        // both sets name the old repo's files
        setHighlights([]);
        setEditorHighlights([]);
        refresh();
    }, [refresh]);

    /**
     * The canvas placed a new level. Inside VS Code's panel the editor hears it after the frame that paints it, with
     * what is selected then (`drawn`, V1.8 plan P1 case a): the extension's test and benchmarks wait for it.
     */
    const onDrawn = useCallback(() => {
        measureAfterPaint("map:level");
        if (editor === null) return;
        reportedLevel.current = levelRef.current === null ? null : drawnKey(levelRef.current);
        afterPaint(() => {
            const drawn = drawnNow();
            if (drawn !== null) editor.post(drawn);
        });
    }, [editor, drawnNow]);
    // P1 case b: a new selection on the level already painted is reported after the frame that paints it. A selection
    // that came with a new level waits for that level's onDrawn, so a `drawn` never runs ahead of the paint.
    useEffect(() => {
        if (editor === null || drawnNow() === null) return;
        return afterPaint(() => {
            const drawn = drawnNow();
            if (drawn !== null) editor.post(drawn);
        });
    }, [selected, editor, drawnNow]);
    /** The repo's name in the top bar goes back to the top level, like a site's name goes home (three-task test). */
    const goHome = useCallback(() => open(""), [open]);
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

    // Escape lets go of the selection, then of Claude Code's highlights; Backspace goes up a level, the arrow keys turn the page, unless the user is typing
    // or a dialog is open over the Map (shortcuts.ts)
    const page = level?.page ?? 0;
    const pageCount = level?.pageCount ?? 1;
    // a doorway selected before an index update re-paged the folder may be gone (portals.ts)
    const shownSelected = selectionShown(level, selected);
    // Esc goes by what is drawn: a selection that vanished with its doorway mustn't take a press before the highlights
    const hasSelection = shownSelected !== null;
    // Claude's alone: the editor's go when What depends' pick closes
    const hasHighlights = highlights.length > 0;
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const shortcut = mapShortcut(event, {
                typing: event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName),
                // the dialogs render into the page's body (portals), so the page itself says whether one is open
                dialogOpen: document.querySelector('[role="dialog"]') !== null,
                levelPath,
                page,
                pageCount,
                selected: hasSelection,
                highlighted: hasHighlights,
            });
            if (shortcut === null) return;
            if (shortcut.type === "search"){
                event.preventDefault();
                setPaletteOpen(true);
            } else if (shortcut.type === "help") setHelpOpen(true);
            else if (shortcut.type === "deselect") setSelected(null);
            else if (shortcut.type === "clear-highlights") clearHighlights();
            else if (shortcut.type === "up") open(parentOf(levelPath));
            else turnPage(shortcut.page);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [levelPath, open, page, pageCount, turnPage, hasSelection, hasHighlights, clearHighlights]);

    const jumpError = focusError !== null && focusError.place === cacheKey(place) && focusError.selected === selected ? focusError.error : null;
    const banner = levelError ?? jumpError;

    if (statusError?.code === "INDEX_EMPTY") return <EmptyState />;

    return (
        <div className="absolute inset-0 flex flex-col">
            <TopBar
                repo={repo ? <RepoMenu repo={repo} onSwitched={onSwitched} onHome={goHome} /> : null}
                onSearch={() => setPaletteOpen(true)}
                status={<StatusPill status={status} />}
                onHelp={() => setHelpOpen(true)}
            />
            <div className="pointer-events-auto relative z-10 flex h-10 items-center justify-between gap-4 border-b border-hairline bg-canvas px-4">
                {level && repo ? <Breadcrumb repo={repo} trail={level.breadcrumb} onOpen={open} /> : <span />}
                <div className="flex shrink-0 items-center gap-4 text-[12px] text-text-2">
                    {level && isBusyLevel(level.edges.length) && (
                        <span data-testid="lines-note">
                            {showAllLines ? `All ${formatCount(level.edges.length)} lines shown` : "Busy folder: lines show on hover"}
                            {" · "}
                            <button
                                type="button"
                                data-testid="lines-toggle"
                                onClick={() => setShowAllLines((all) => !all)}
                                className="text-control underline underline-offset-2 hover:text-text"
                            >
                                {showAllLines ? "Show on hover only" : "Show all lines"}
                            </button>
                        </span>
                    )}
                </div>
            </div>
            <main className="relative flex-1">
                {level && (
                    <MapCanvas
                        level={level}
                        selected={shownSelected}
                        agent={agent}
                        pulses={pulses}
                        onSelect={select}
                        onOpen={open}
                        onTurnPage={turnPage}
                        onDrawn={onDrawn}
                        quietLines={!showAllLines && isBusyLevel(level.edges.length)}
                    />
                )}
                {level && pageCount > 1 && (
                    <>
                        <PagePill level={level} onTurn={turnPage} panelOpen={shownSelected !== null} />
                    </>
                )}
                {!level && !levelError && <p className="absolute inset-0 grid place-items-center text-[13px] text-text-2">Loading the map…</p>}
                {banner && <p className="absolute inset-x-0 top-6 text-center text-[13px] text-danger">{banner.message}</p>}
                {shownSelected !== null && level && (
                    <DetailPanel
                        key={shownSelected}
                        path={shownSelected}
                        level={level}
                        indexVersion={version ?? 0}
                        onFocus={focus}
                        onOpen={open}
                        onTurnPage={turnPage}
                        onClose={closePanel}
                        onOpenInEditor={editor === null ? undefined : openInEditor}
                    />
                )}
            </main>
            <ActivityBar recent={live.recent} connected={live.connected} highlightCount={highlights.length} onClear={clearHighlights} />
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

/**
 * Which page of a big folder is on screen, in the canvas's top-right corner with a button either side: the one place to
 * turn the page with the mouse (← and → turn it too). The three-task test found the top bar's note went unseen; a bar at
 * the bottom of the canvas then read as loud and, in the boxes' colour, blended in (owner review). Big arrows at the
 * canvas's sides went too, after a second critique: two ways to do one thing, and the right one sat on a box when the
 * panel was open. Like the other overlays it's a solid card in the logo's violet with no outline, so it reads as neither
 * a box nor a line, its buttons cyan; it moves left of the panel when the panel opens.
 */
function PagePill({ level, onTurn, panelOpen }: { level: LevelResponse; onTurn: (page: number) => void; panelOpen: boolean }){
    const step = (side: "left" | "right") => {
        const next = side === "left" ? level.page - 1 : level.page + 1;
        const Icon = side === "left" ? IconChevronLeft : IconChevronRight;
        const off = next < 0 || next >= level.pageCount;
        return (
            <button
                type="button"
                data-testid={`page-${side === "left" ? "previous" : "next"}`}
                disabled={off}
                onClick={() => onTurn(next)}
                aria-label={`${side === "left" ? "Previous" : "Next"} page`}
                title={`${side === "left" ? "Previous" : "Next"} page (${side === "left" ? "←" : "→"})`}
                className="grid h-9 w-9 place-items-center rounded-md text-control hover:bg-overlay-line disabled:opacity-35 disabled:hover:bg-transparent"
            >
                <Icon aria-hidden size={22} stroke={2} />
            </button>
        );
    };
    // "Page 2 of 5 · 44 of 182 folders and files": the page in the text color, the count quieter
    const [pagePart, ...rest] = pageNote(level).split(" · ");
    return (
        <div
            style={{ right: (panelOpen ? PANEL_WIDTH : 0) + 16 }}
            className="absolute top-4 z-[7] flex items-center gap-1.5 rounded-lg bg-overlay p-1"
        >
            {step("left")}
            <span data-testid="page-note" className="px-1 text-[14px] text-text">
                {pagePart}
                {rest.length > 0 && <span className="text-overlay-text-2"> · {rest.join(" · ")}</span>}
            </span>
            {step("right")}
        </div>
    );
}

function EmptyState(){
    return (
        <div className="absolute inset-0 grid place-items-center">
            <div className="max-w-md space-y-2 text-center text-[14px] text-text-2">
                <p className="text-[15px] font-medium text-text">No repository indexed yet.</p>
                <p>Index one from a terminal, then reload: <code className="rounded-md bg-code-bg px-1 font-mono text-[13px] text-code">nebulosity index &lt;path-to-repo&gt;</code></p>
                <p>In a checkout of Nebulosity: <code className="rounded-md bg-code-bg px-1 font-mono text-[13px] text-code">npm run index -- &lt;path-to-repo&gt;</code></p>
            </div>
        </div>
    );
}
