"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { BridgeFromMap, BridgeToMap, LevelResponse, LiveEvent } from "@/lib/contracts";
import { api, ApiError } from "./api";
import Breadcrumb from "./Breadcrumb";
import DetailPanel from "./DetailPanel";
import HelpDialog from "./HelpDialog";
import { AGENT_ACTIVE_MS, agentFocus } from "./activity";
import { isBusyLevel, weakLinesHidden } from "./emphasis";
import MapCanvas from "./MapCanvas";
import { followStep, historyDepth, historyStep, mapUrl, placeFromSearch, type MapPlace } from "./history";
import { bannerForm, CARD_CLEAR, type BannerForm } from "./narrow";
import { boxFor, parentOf } from "./paths";
import { clearStart, markStart, measureAfterPaint } from "./perf";
import { selectionShown } from "./portals";
import { mapShortcut } from "./shortcuts";
import { nextPulses, type Pulse } from "./pulses";
import RepoMenu from "./RepoMenu";
import SearchPalette from "./SearchPalette";
import { applyTheme, themeInputOf } from "./theme";
import Explorer from "./Explorer";
import Header from "./Header";
import Legend from "./Legend";
import MapToolbar from "./MapToolbar";
import { BELOW_SHARE, EXPLORER_WIDTH, INSPECTOR_WIDTH, RAIL_WIDTH, shellLayout } from "./shell";
import StatusBar from "./StatusBar";
import { EMBEDDED, useEditorBridge, useEmbedded } from "./useEditorBridge";
import { useIndexStatus } from "./useIndexStatus";
import { useLive } from "./useLive";
import { useSize } from "./useSize";
import { useWindowSize } from "./useWindowSize";

/**
 * Levels fetched for one repo and index version (ADR-036), by folder and page: going back up a level is instant until
 * the index moves.
 */
type LevelCache = { repo: string; version: number; levels: ReadonlyMap<string, LevelResponse> };

const cacheKey = (place: MapPlace): string => `${place.path}\0${place.page}`;
/** How long a failed jump's message stays up when nothing else moves the Map. */
const FOCUS_ERROR_MS = 6_000;
/** The inspector as a drawer over the canvas's right side: 320 px, leaving at least 56 px of canvas beside it. */
const DRAWER_WIDTH = "min(320px, calc(100% - 56px))";

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
    // While the panel would cover the canvas, a click only selects: the box shows Open and Details beside it
    // (BoxActions), so a double click still reaches it and the Map stays in sight (owner review, 2026-10-25). This is
    // the box whose Details asked for the panel over the canvas; its × gives it back to null with the box still
    // selected. Any other selection starts with its details closed, reset as the selection changes (React's way to
    // reset state when what it belongs to changes, during render, so no frame shows the old panel over the new one).
    const [detailsFor, setDetailsFor] = useState<string | null>(null);
    const [detailsSelection, setDetailsSelection] = useState(selected);
    if (detailsSelection !== selected){
        setDetailsSelection(selected);
        setDetailsFor(null);
    }
    // Whether the history entry on screen has one of the Map's own steps behind it, for Back inside VS Code's panel
    // (BackButton, history.ts's historyDepth). It shows only once a level is drawn, in the browser, so reading the
    // history here can't make the server's render and the browser's differ.
    const [canGoBack, setCanGoBack] = useState(() => typeof window !== "undefined" && historyDepth(window.history.state) > 0);
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
    // Strong links only, on until it's turned off, and like Show all lines it holds across levels (ADR-070)
    const [strongOnly, setStrongOnly] = useState(true);
    const [pulses, setPulses] = useState<ReadonlyMap<string, Pulse>>(new Map());
    // the Map area's width: whether the panel covers the canvas and the page pill's wording go by it (narrow.ts); the
    // pill's width and the banner's height decide where the banner goes
    // the window's size, which the layout goes by (shell.ts), and the error banner's, which picks its form (narrow.ts)
    const windowSize = useWindowSize();
    // inside VS Code's panel, as the page draws it (hydration-safe)
    const embedded = useEmbedded();
    const [mainRef] = useSize<HTMLElement>();
    const [bandRef, bandSize] = useSize<HTMLDivElement>();
    const [cardRef] = useSize<HTMLDivElement>();

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
                    window.history.replaceState({ mapDepth: historyDepth(window.history.state) }, "", mapUrl(at.path, at.page, EMBEDDED));
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
    // made rewrites the entry instead of pushing one, so switching tabs doesn't fill Back (followStep). Each entry carries
    // how many of the Map's own steps lie behind it (historyDepth), for the Back button there.
    useEffect(() => {
        const step = followStep(historyStep(window.location.pathname + window.location.search, place, EMBEDDED), historyMode.current);
        historyMode.current = "push";
        const depth = historyDepth(window.history.state);
        if (step === "push"){
            window.history.pushState({ mapDepth: depth + 1 }, "", mapUrl(place.path, place.page, EMBEDDED));
            setCanGoBack(true);
        } else if (step === "replace") window.history.replaceState({ mapDepth: depth }, "", mapUrl(place.path, place.page, EMBEDDED));
    }, [place]);
    useEffect(() => {
        const onPop = (): void => {
            markStart("map:level");
            setPlace(placeFromSearch(window.location.search));
            setSelected(null);
            setFocusing(null);   // a jump still on its way would otherwise land after Back and undo it
            setCanGoBack(historyDepth(window.history.state) > 0);
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
     * files to light, and its color theme. Only the Map's own clicks open files in the editor, so nothing here echoes back
     * (V1.8 plan P10).
     */
    const onEditorMessage = useCallback((message: BridgeToMap) => {
        if (message.type === "nebulosity.follow") focus(message.path, { history: "replace", quiet: true });
        else if (message.type === "nebulosity.show") focus(message.path, { quiet: true });
        else if (message.type === "nebulosity.highlight") setEditorHighlights(message.paths);
        else if (message.type === "nebulosity.clear") setEditorHighlights([]);
        else if (message.type === "nebulosity.theme"){
            // the editor's own grays (ADR-070): set on the page's root, over globals.css's Dark 2026
            const theme = themeInputOf(message.kind, message.colors);
            if (theme !== null) applyTheme(document.documentElement, theme);
        }
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
    // the boxes joined to the selection by a line, which the explorer lights as the canvas does
    const selectedOnLevel = selectionShown(level, selected);
    const linked = useMemo(() => new Set(level === null || selectedOnLevel === null ? [] : level.edges
        .filter((e) => e.source === selectedOnLevel || e.target === selectedOnLevel).flatMap((e) => [e.source, e.target])), [level, selectedOnLevel]);

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
    /** The repo's name in the breadcrumb goes back to the top level, like a site's name goes home (three-task test). */
    const goHome = useCallback(() => open(""), [open]);
    const closeHelp = useCallback(() => setHelpOpen(false), []);
    // The help no longer opens by itself on a first visit: the legend sentence under the canvas says what the marks mean,
    // and the full help stays behind ? (the Workbench redesign, ADR-070).
    const closePanel = useCallback(() => setSelected(null), []);
    // over the canvas, the inspector's × closes the details and leaves the box selected, with its actions (BoxActions)
    const closeDetails = useCallback(() => setDetailsFor(null), []);
    const showDetails = useCallback((path: string) => setDetailsFor(path), []);

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
    // The layout at this window's size (shell.ts): where the explorer and the inspector go, what the bars keep, and the
    // least height before the page scrolls down. Where the inspector would cover the whole canvas, a click only selects
    // and the box offers Open and Details beside it (BoxActions); everywhere else the inspector shows the selection.
    const shell = shellLayout({ width: windowSize.width, height: windowSize.height, embedded, selected: shownSelected !== null });
    const covers = shell.inspector === "cover";
    // Anywhere but over the whole canvas the inspector is the selection's details, so they count as asked for: a window
    // narrowed while they're open keeps them, now over the canvas, rather than swapping them for the box's actions.
    if (!covers && shownSelected !== null && detailsFor !== shownSelected) setDetailsFor(shownSelected);
    const detailsOverCanvas = covers && shownSelected !== null && detailsFor === shownSelected;
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
            // over the canvas, Escape closes the details first, as the inspector's × does, and the box stays selected
            else if (shortcut.type === "deselect"){
                if (detailsOverCanvas) setDetailsFor(null);
                else setSelected(null);
            } else if (shortcut.type === "clear-highlights") clearHighlights();
            else if (shortcut.type === "up") open(parentOf(levelPath));
            else turnPage(shortcut.page);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [levelPath, open, page, pageCount, turnPage, hasSelection, hasHighlights, clearHighlights, detailsOverCanvas]);

    // how many lines Strong links only hides right now, before a hover adds any back
    const weakHidden = level !== null && strongOnly ? weakLinesHidden(level.edges, shownSelected, agent) : 0;
    const jumpError = focusError !== null && focusError.place === cacheKey(place) && focusError.selected === selected ? focusError.error : null;
    const banner = levelError ?? jumpError;

    // the inspector shows the selection, or beside the canvas with nothing selected the folder on screen; over the whole
    // canvas only once the box's Details asks for it
    const inspectorPath = shownSelected ?? (shell.inspector === "beside" && level !== null ? level.path : null);
    const inspectorOpen = level !== null && inspectorPath !== null && shell.inspector !== "none" && (!covers || detailsOverCanvas);
    const covered = inspectorOpen && covers;
    // the selected box's actions, while the inspector would cover the canvas and its details aren't asked for yet
    const actionsFor = covers && !inspectorOpen ? shownSelected : null;
    const bannerOnCanvas = banner !== null && !covered;
    const drawerOpen = inspectorOpen && shell.inspector === "drawer";
    const bannerAs = bannerForm(bandSize?.height ?? null);
    const busy = level !== null && isBusyLevel(level.edges.length);
    const quietLines = !showAllLines && busy;
    const items = level === null ? 0 : level.nodes.filter((n) => n.kind !== "portal").length;

    if (statusError?.code === "INDEX_EMPTY") return <EmptyState />;

    const toolbar = level && (
        <MapToolbar
            level={level}
            strongOnly={strongOnly}
            onStrongOnly={setStrongOnly}
            busy={busy}
            showAllLines={showAllLines}
            onShowAllLines={setShowAllLines}
            onTurnPage={turnPage}
            canvasWidth={shell.canvasWidth}
            inHeader={shell.toolbarInHeader}
            narrow={windowSize.width < 480}
            helpInMenu={embedded || windowSize.width < 480}
            onHelp={() => setHelpOpen(true)}
            // the header hides its search icon under 360 px while the toolbar shares it (Header)
            searchInMenu={shell.toolbarInHeader && windowSize.width < 360}
            onSearch={() => setPaletteOpen(true)}
        />
    );
    const statusBar = (dots: boolean) => (
        <StatusBar
            status={status}
            recent={live.recent}
            connected={live.connected}
            highlightCount={highlights.length}
            onClear={clearHighlights}
            items={items}
            weakHidden={weakHidden}
            embedded={embedded}
            dots={dots}
        />
    );
    const inspector = inspectorOpen && inspectorPath !== null && level && shell.inspector !== "none" && (
        <DetailPanel
            key={inspectorPath}
            path={inspectorPath}
            level={level}
            indexVersion={version ?? 0}
            onFocus={focus}
            onOpen={open}
            onTurnPage={turnPage}
            onClose={covers ? closeDetails : closePanel}
            onOpenInEditor={editor === null ? undefined : openInEditor}
            placement={shell.inspector}
            onScreenFolder={shownSelected === null}
            alert={covered ? banner?.message : undefined}
        />
    );

    // The page fills the window; below the layout's least height it keeps that height and scrolls down, never sideways
    // (shell.ts). Header, then the explorer, the canvas's column and the inspector beside it, then the status bar.
    return (
        <div data-testid="map-shell" style={{ minHeight: shell.minHeight }} className="flex h-dvh flex-col">
            <Header
                crumb={level && repo
                    ? <Breadcrumb repo={<RepoMenu repo={repo} onSwitched={onSwitched} onHome={goHome} />} repoRoot={repo} trail={level.breadcrumb} onOpen={open} compact={windowSize.width < 360} />
                    : <span className="min-w-0 flex-1" />}
                onSearch={() => setPaletteOpen(true)}
                onHelp={() => setHelpOpen(true)}
                embedded={embedded}
                canGoBack={canGoBack}
                toolbar={shell.toolbarInHeader ? toolbar : undefined}
                status={shell.status === "inHeader" ? statusBar(true) : undefined}
            />
            <div className="flex min-h-0 flex-1">
                {level && shell.explorer !== "none" && (
                    <div style={{ width: shell.explorer === "full" ? EXPLORER_WIDTH : RAIL_WIDTH }} className="relative z-10 shrink-0">
                        <Explorer level={level} selected={shownSelected} linked={linked} form={shell.explorer} onSelect={select} onOpen={open} />
                    </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                    {!shell.toolbarInHeader && toolbar}
                    <main ref={mainRef} className="relative min-h-0 flex-1 overflow-hidden">
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
                                quietLines={quietLines}
                                strongOnly={strongOnly}
                                covered={covered}
                                actionsFor={actionsFor}
                                onDetails={showDetails}
                            />
                        )}
                        {!level && !levelError && <p className="absolute inset-0 grid place-items-center px-4 text-center text-[13px] text-text-2">Loading the map…</p>}
                        {/* left of a drawer, which would cover the line's end: centred in what's left, and measured there, so
                            a line that needs more than two lines there becomes the card */}
                        {banner && bannerOnCanvas && (
                            <div style={{ right: drawerOpen ? DRAWER_WIDTH : 0 }} className="pointer-events-none absolute inset-y-0 left-0">
                                <ErrorBanner message={banner.message} form={bannerAs} bandRef={bandRef} cardRef={cardRef} />
                            </div>
                        )}
                        {/* over the canvas: a drawer on its right, or the whole of it */}
                        {(shell.inspector === "drawer" || shell.inspector === "cover") && inspector && (
                            <div data-inspector-place={shell.inspector} style={{ width: shell.inspector === "drawer" ? DRAWER_WIDTH : "100%" }} className="absolute inset-y-0 right-0 z-10">
                                {inspector}
                            </div>
                        )}
                    </main>
                    {level && shell.legend && (
                        <Legend doorways={level.nodes.some((n) => n.kind === "portal")} agent={agent.size > 0} quiet={quietLines} />
                    )}
                    {shell.inspector === "below" && inspector && (
                        <div data-inspector-place="below" style={{ height: `${BELOW_SHARE * 100}%` }} className="min-h-0 shrink-0">{inspector}</div>
                    )}
                </div>
                {shell.inspector === "beside" && inspector && (
                    <div data-inspector-place="beside" style={{ width: INSPECTOR_WIDTH }} className="min-h-0 shrink-0">{inspector}</div>
                )}
            </div>
            {shell.status === "bar" && statusBar(false)}
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
 * The Map's error line over the canvas (a failed jump, a level that wouldn't load: VISUAL_REFRESH.md §10). It takes no
 * clicks, so it never stands between the pointer and the boxes under it.
 * - **band** (its place at normal sizes): 24 px down, centred over the canvas, wrapping as it must.
 * - **card**, where the band would need more than its two lines: a solid card in the canvas's top-left corner.
 * The band is always laid out, unseen while the card shows, so its height (which picks the form) is always known.
 */
function ErrorBanner({ message, form, bandRef, cardRef }: {
    message: string;
    form: BannerForm;
    bandRef: (element: HTMLDivElement | null) => void;
    cardRef: (element: HTMLDivElement | null) => void;
}){
    return (
        <>
            <div
                ref={bandRef}
                role={form === "band" ? "alert" : undefined}
                aria-hidden={form === "band" ? undefined : true}
                className={`pointer-events-none absolute inset-x-0 top-6 z-[7] flex justify-center px-4 text-[13px] text-danger ${form === "band" ? "" : "invisible"}`}
            >
                <p className="max-w-full rounded-[5px] bg-canvas px-2 text-center [overflow-wrap:anywhere]">{message}</p>
            </div>
            {form === "card" && (
                <div
                    ref={cardRef}
                    role="alert"
                    style={{ maxWidth: `calc(100% - ${CARD_CLEAR}px)` }}
                    className="pointer-events-none absolute left-4 top-4 z-[7] rounded-md border border-divider bg-panel px-3 py-2 text-[13px] text-danger [overflow-wrap:anywhere]"
                >
                    {message}
                </div>
            )}
        </>
    );
}

function EmptyState(){
    return (
        <div className="grid h-dvh place-items-center px-4">
            <div className="max-w-md space-y-2 text-center text-[14px] text-text-2 [overflow-wrap:anywhere]">
                <p className="text-[15px] font-medium text-text">No repository indexed yet.</p>
                <p>Index one from a terminal with <code className="rounded-md bg-node px-1 font-mono text-[13px] text-text">nebulosity index &lt;path-to-repo&gt;</code>, then reload.</p>
                <p>In a checkout of Nebulosity it&apos;s <code className="rounded-md bg-node px-1 font-mono text-[13px] text-text">npm run index -- &lt;path-to-repo&gt;</code>.</p>
            </div>
        </div>
    );
}
