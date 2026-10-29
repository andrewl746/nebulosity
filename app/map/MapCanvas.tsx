"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    ReactFlow, useEdgesState, useNodesState, useReactFlow, useStore, ViewportPortal,
    type EdgeMouseHandler, type EdgeTypes, type NodeMouseHandler, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LevelResponse, MapEdge } from "@/lib/contracts";
import BoxActions from "./BoxActions";
import { edgeKey, lineLook, mapEmphasis, type BoxTone } from "./emphasis";
import { reuseUnchanged, sameBoxNode, sameRoutedEdge, toBoxNode } from "./flowNodes";
import { formatCount } from "./format";
import { runWords } from "./labels";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, looseDivider, perRowFor, type Divider, type Position } from "./levelLayout";
import LineCard from "./LineCard";
import MapBox, { borderOf, shade, type BoxData, type BoxNode } from "./MapBox";
import type { CanvasRect } from "./narrow";
import { portalCaption, portalDirection, portalLinks, portalTitle } from "./portals";
import type { Pulse } from "./pulses";
import RoutedEdge, { type RoutedEdgeType } from "./RoutedEdge";
import { headRooms, nextRoutes, placeCounts, routeEdges, type Point, type Rect } from "./routes";
import { linesSharing, pointedBits } from "./runs";
import { isLightKind } from "./theme";
import { useThemeKind } from "./useThemeKind";
import { boundsOf, drawnLinesBounds, initialViewport } from "./viewport";
import { arrowHead, boxHeadWidths, dotSize, labelledLines, lineWidth, maxFilesOf, maxImportsOf } from "./weights";

/** The line ids a key of ids joined by newlines names. */
const keySet = (key: string): Set<string> => new Set(key === "" ? [] : key.split("\n"));

/**
 * What a page's counts are placed by: its lines, each one's width and label size, and the boxes a count keeps off.
 */
type CountPage = { edges: readonly MapEdge[]; widths: Map<string, number>; sizes: Map<string, { width: number; height: number }>; boxes: Rect[] };

/**
 * Where the counts of `labelled` go among the lines of `routes` that are `drawn`, from the places `kept` gives them
 * (placeCounts), clear of the boxes and of the arrowheads those lines draw (headRooms).
 */
function countsOn(page: CountPage, routes: ReadonlyMap<string, Point[]>, drawn: ReadonlySet<string>, labelled: ReadonlySet<string>, kept: ReadonlyMap<string, Point>): Map<string, Point> {
    const on = new Map([...routes].filter(([id]) => drawn.has(id)));
    const labels = new Map([...on.keys()].filter((id) => labelled.has(id)).map((id) => [id, page.sizes.get(id)!]));
    return placeCounts(on, page.widths, labels, [...page.boxes, ...headRooms(on, page.edges)], kept);
}

/**
 * What's on screen, and what it was worked out from: the rest routes, the lines drawn and their routes, and the counts.
 * `settled` is the lines drawn without the hover, `restCounts` rest's counts and `settledCounts` the counts without
 * the hover (the selection's, from rest's), which a hover's `counts` start from.
 */
type Shown = {
    rest: Map<string, Point[]>;
    drawn: string;
    routes: Map<string, Point[]>;
    selected: string | null;
    settled: string;
    restCounts: Map<string, Point>;
    settledCounts: Map<string, Point>;
    counts: Map<string, Point>;
};

/**
 * The lines under the pointer (runs.ts's linesSharing), by `key`, their ids joined by newlines: where the pointer
 * landed on their run, and the bit of line there and what's over the canvas then (canvas px), which the hover card
 * keeps off.
 */
type LineHover = { key: string; lines: string[]; pointer: Point; line: CanvasRect[]; clear: CanvasRect[] };

// at module scope: a new object per render would make React Flow remount every box and line
const nodeTypes: NodeTypes = { box: MapBox };
const edgeTypes: EdgeTypes = { routed: RoutedEdge };

type MapCanvasProps = {
    level: LevelResponse;
    selected: string | null;
    /** Boxes Claude Code is touching right now: recent tool calls and show_on_map highlights. */
    agent: ReadonlySet<string>;
    pulses: ReadonlyMap<string, Pulse>;
    onSelect: (path: string | null) => void;
    onOpen: (folder: string) => void;
    /** Turn to another page of this folder: a portal was double-clicked. */
    onTurnPage: (page: number) => void;
    /** Called once a new level is on screen (S3's measuring point). */
    onDrawn: () => void;
    /** A busy level: only the hovered or selected box's lines are drawn (emphasis.ts). */
    quietLines: boolean;
    /** Strong links only: a weak line is drawn only when it touches the selection, the hovered box or a lit box (emphasis.ts). */
    strongOnly: boolean;
    /**
     * The inspector covers the whole canvas (a window both narrow and short, shell.ts): the boxes can't be reached by Tab
     * then, until its × brings the canvas back.
     */
    covered: boolean;
    /**
     * The selected box that shows its actions beside it (BoxActions), or null: while the panel would cover the canvas,
     * a click only selects, and Details asks for the panel.
     */
    actionsFor: string | null;
    onDetails: (path: string) => void;
};

/**
 * The canvas (VISUAL_REFRESH.md §4): one level's boxes, laid out by dagre, and an arrow for every import line, routed
 * around the boxes (routes.ts). A click selects (where the panel would cover the canvas, the selected box shows its
 * actions beside it: BoxActions); a double click opens a folder, or turns to a portal's page. The selection's lines turn purple (what it uses) and pink (what uses it), and unrelated boxes fade;
 * hovering a box previews its lines without selecting it, and hovering a line names every line on that run beside the
 * pointer, a click on it keeping the list (LineCard). React Flow stays controlled with the StrictMode workaround in
 * next.config.ts.
 */
function MapCanvas({ level, selected, agent, pulses, onSelect, onOpen, onTurnPage, onDrawn, quietLines, strongOnly, covered, actionsFor, onDetails }: MapCanvasProps){
    // a wide canvas wraps layers at 8 a row instead of 6, so dense levels fit larger (levelLayout.ts)
    const perRow = useStore((s) => perRowFor(s.width));
    // React Flow's own parts follow a light VS Code theme (theme.ts)
    const themeKind = useThemeKind();
    const positions = useMemo(() => layoutLevel(level.nodes, level.edges, undefined, perRow), [level, perRow]);
    const divider = useMemo(() => looseDivider(level.nodes, level.edges, positions), [level, positions]);
    const byPath = useMemo(() => new Map(level.nodes.map((n) => [n.path, n])), [level]);
    // each portal's arrow, "Lines to page 2" and "44 folders and files, 6 imports", worked out once per level, not on every hover
    const portals = useMemo(() => new Map<string, BoxData["portal"]>(level.nodes.filter((n) => n.kind === "portal").map((n) => [
        n.path,
        { direction: portalDirection(n, level.page), title: portalTitle(n), caption: portalCaption(n, portalLinks(level.edges, n.path)) },
    ])), [level]);
    // dots and lines are scaled against the page's largest folder and heaviest line (weights.ts)
    const maxFiles = useMemo(() => maxFilesOf(level.nodes), [level]);
    const maxImports = useMemo(() => maxImportsOf(level.edges), [level]);
    // each box's one head, sized from every line on the level, drawn or not, as routing sized the room above it
    const heads = useMemo(() => boxHeadWidths(level.edges), [level]);
    const labelled = useMemo(() => labelledLines(level.edges, selected), [level, selected]);
    const [lineHover, setLineHover] = useState<LineHover | null>(null);
    // the hover card a click on a run pinned, every line listed (LineCard)
    const [pinned, setPinned] = useState<LineHover | null>(null);
    const [hoveredBox, setHoveredBox] = useState<string | null>(null);
    // A hover belongs to the level it happened on. Going into a folder unmounts the old boxes before their mouseleave
    // fires, so the hover outlived the level, and coming back (a cached level, the same object as before) lit that box
    // up with nothing under the pointer (deferred minor). So it's cleared whenever another level is drawn: React's way
    // to reset state when a prop changes, during render rather than in an effect, so no frame shows the stale hover.
    // A pinned card goes with it.
    const [drawnLevel, setDrawnLevel] = useState(level);
    if (drawnLevel !== level){
        setDrawnLevel(level);
        setHoveredBox(null);
        setLineHover(null);
        setPinned(null);
    }
    const emphasis = useMemo(
        // the boxes Claude Code or the editor has lit keep their lines, whatever hides the rest
        () => mapEmphasis(level.nodes.map((n) => n.path), level.edges, selected, hoveredBox, { quietLines, strongOnly, pinned: agent }),
        [level, selected, hoveredBox, quietLines, strongOnly, agent],
    );
    // The lines drawn at rest (nothing selected, hovered or lit) are routed once, among themselves (routes.ts). A line a
    // selection, a hover or a lit box adds is routed when it appears: it takes its boxes' points (a box has one a side)
    // and, where it fits, the lanes and tracks their drawn lines are on, and goes around every other line on screen. It
    // keeps that route while it stays, so pointing at a box or clicking one never moves a line that's drawn (the owner,
    // 2026-10-27). Keyed by content: a hover that draws the same lines keeps every route.
    const restKey = useMemo(() => {
        const rest = mapEmphasis(level.nodes.map((n) => n.path), level.edges, null, null, { quietLines, strongOnly });
        return level.edges.map(edgeKey).filter((id) => rest.edges.get(id) !== "hidden").join("\n");
    }, [level, quietLines, strongOnly]);
    const restRoutes = useMemo(() => routeEdges(positions, level.edges, keySet(restKey)), [positions, level, restKey]);
    const drawnKey = level.edges.map(edgeKey).filter((id) => emphasis.edges.get(id) !== "hidden").join("\n");
    // the lines drawn without the hover: rest's, and the selection's and the lit boxes' on top
    const settledKey = useMemo(() => {
        const settled = mapEmphasis(level.nodes.map((n) => n.path), level.edges, selected, null, { quietLines, strongOnly, pinned: agent });
        return level.edges.map(edgeKey).filter((id) => settled.edges.get(id) !== "hidden").join("\n");
    }, [level, selected, quietLines, strongOnly, agent]);
    // what a count keeps clear of: every other line by its width, every other count, its label sized from its count's
    // text as RoutedEdge writes it (7 px a character and 14 of padding and border, by 18), every box with its back card,
    // and every arrowhead drawn (countsOn)
    const countPage = useMemo((): CountPage => ({
        edges: level.edges,
        widths: new Map(level.edges.map((e) => [edgeKey(e), lineWidth(e.count, maxImports)])),
        sizes: new Map(level.edges.map((e) => [edgeKey(e), { width: formatCount(e.count).length * 7 + 14, height: 18 }])),
        boxes: level.nodes.flatMap((box) => {
            const at = positions.get(box.path);
            return at === undefined ? [] : [{ x: at.x + (BOX_WIDTH + 5) / 2, y: at.y + (BOX_HEIGHT + 5) / 2, width: BOX_WIDTH + 5, height: BOX_HEIGHT + 5 }];
        }),
    }), [level, positions, maxImports]);
    // What's on screen, and what it was worked out from: React's way to keep state that follows a prop, set during render.
    // A count is placed from a base, so lines that appear move only the counts they run into (placeCounts): rest's are
    // placed afresh, the screen without a hover (a selection, or a lit box) starts from rest's, and a hover from the
    // screen without it. Rest's and the selection's are held beside the routes, so a count a hovered line pushed aside
    // goes back when the hover ends, and nothing chains from one hover to the next. New rest routes (another level, or
    // Strong links only or Show all lines turned) start the counts afresh with them.
    const follow = (previous: Shown | null): Shown => {
        const fresh = previous === null || previous.rest !== restRoutes;
        // the same lines keep the routes they have, rest's lines included, which nextRoutes would give back as they are
        const before = fresh ? restRoutes : previous.routes;
        const routes = drawnKey === (fresh ? restKey : previous.drawn) ? before : nextRoutes(positions, level.edges, restRoutes, before, keySet(drawnKey));
        const restCounts = fresh ? countsOn(countPage, restRoutes, keySet(restKey), labelledLines(level.edges, null), new Map()) : previous.restCounts;
        // a hover draws more lines and never hides one, so the lines without it are on screen, where they'll stay
        const settledCounts = !fresh && previous.selected === selected && previous.settled === settledKey
            ? previous.settledCounts
            : countsOn(countPage, routes, keySet(settledKey), labelled, restCounts);
        const counts = drawnKey === settledKey ? settledCounts : countsOn(countPage, routes, keySet(drawnKey), labelled, settledCounts);
        return { rest: restRoutes, drawn: drawnKey, routes, selected, settled: settledKey, restCounts, settledCounts, counts };
    };
    const [shown, setShown] = useState(() => follow(null));
    if (shown.rest !== restRoutes || shown.drawn !== drawnKey || shown.selected !== selected || shown.settled !== settledKey) setShown(follow(shown));
    const { routes, counts } = shown;
    const [nodes, setNodes, onNodesChange] = useNodesState<BoxNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<RoutedEdgeType>([]);
    const { setViewport, getViewport, screenToFlowPosition } = useReactFlow();
    const canvasWidth = useStore((s) => s.width);
    const canvasHeight = useStore((s) => s.height);
    const canvas = useStore((s) => s.domNode);
    // the latest of each, for the opening view below: it runs when the level changes, not when they do. The lines on
    // screen are framed with the boxes (viewport.ts), measured only when a level opens or refits, not on every hover
    const openRef = useRef({ setViewport, onDrawn, positions, routes, edges: level.edges, canvas: { width: canvasWidth, height: canvasHeight } });
    useEffect(() => {
        openRef.current = { setViewport, onDrawn, positions, routes, edges: level.edges, canvas: { width: canvasWidth, height: canvasHeight } };
    }, [setViewport, onDrawn, positions, routes, level.edges, canvasWidth, canvasHeight]);
    // whether the person has panned or zoomed since the level opened (a programmatic move has no event)
    const moved = useRef(false);

    useEffect(() => {
        // with their size and attach points given, the lines never wait for React Flow to measure (flowNodes.ts); a box
        // that would draw the same keeps its object, so a hover redraws only the boxes it changes
        const next = level.nodes.map((box) => toBoxNode(box, positions.get(box.path) ?? { x: 0, y: 0 }, {
            box,
            tone: emphasis.boxes.get(box.path) ?? "normal",
            agent: agent.has(box.path),
            pulseKey: pulses.get(box.path)?.key ?? 0,
            dot: dotSize(box.fileCount, maxFiles),
            portal: portals.get(box.path),
        }));
        setNodes((previous) => reuseUnchanged(previous, next, sameBoxNode));
    }, [level, positions, portals, emphasis, agent, pulses, maxFiles, setNodes]);

    useEffect(() => {
        // a busy level's hidden lines aren't handed to React Flow at all: fewer lines to draw, and none to hover
        const drawn = level.edges.flatMap((edge) => {
            const id = edgeKey(edge);
            const tone = emphasis.edges.get(id) ?? "normal";
            if (tone === "hidden") return [];
            const look = lineLook(tone, edge, selected);
            const drawnEdge: RoutedEdgeType = {
                id,
                type: "routed",
                data: {
                    points: routes.get(id) ?? [],
                    width: lineWidth(edge.count, maxImports),
                    headWidth: heads.get(edge.target),
                    color: look.color,
                    // the page's heaviest lines and the selection's carry their count where it has a place clear of
                    // everything else, the selection's in the text color
                    count: counts.has(id) ? formatCount(edge.count) : undefined,
                    countStrong: tone === "selected",
                    labelAt: counts.get(id),
                },
                source: edge.source,
                target: edge.target,
                focusable: false,
            };
            return [{ layer: look.layer, edge: drawnEdge }];
        });
        // the emphasized lines go last, so they're drawn over the quiet ones they cross or share a run with. Order, not
        // zIndex: React Flow lifts an edge with a zIndex above every box, where it would take the box's clicks (final
        // review I2)
        const next = drawn.sort((a, b) => a.layer - b.layer).map((d) => d.edge);
        setEdges((previous) => reuseUnchanged(previous, next, sameRoutedEdge));
    }, [level, routes, counts, emphasis, selected, maxImports, heads, setEdges]);

    // A new level (another folder, or another repo): open it at a readable size (viewport.ts: fitted, its drawn lines
    // too unless that would shrink the boxes under 85% of their own fit or past 75%, and from its top when the boxes
    // alone would shrink past 75%), then report it drawn. The boxes reach React Flow a render after the level does
    // (setNodes runs in an effect), so this waits until `nodes` holds this level's boxes: placing the view sooner
    // frames the previous level's, which is what a level from the cache got. The same level refetched after the index
    // moved keeps its key, so the user's pan and zoom stay put.
    // the row width is in the key: a window resized across WIDE_CANVAS lays the level out again, so it's fitted again
    const levelKey = `${level.repo}\n${level.path}\n${level.page}\n${perRow}`;
    const fittedKey = useRef<string | null>(null);
    useEffect(() => {
        if (fittedKey.current === levelKey) return;
        const arrived = nodes.length === level.nodes.length && nodes.every((node, i) => node.id === level.nodes[i].path);
        if (!arrived) return;
        const frame = requestAnimationFrame(() => {
            fittedKey.current = levelKey;
            moved.current = false;
            const open = openRef.current;
            void open.setViewport(initialViewport(boundsOf(open.positions), open.canvas, 0, drawnLinesBounds(open.routes, open.edges)), { duration: 0 });
            open.onDrawn();
        });
        return () => cancelAnimationFrame(frame);
    }, [levelKey, nodes, level.nodes]);

    // The canvas resized (the window or VS Code's panel dragged, the inspector moving under or beside it): a level nobody
    // has moved since it opened opens again for the new size, and one the person has moved keeps its middle where it
    // was, at the same zoom, so the view stays steady and the selection stays in sight (the owner, 2026-10-27).
    const lastSize = useRef<{ width: number; height: number } | null>(null);
    useEffect(() => {
        const last = lastSize.current;
        lastSize.current = { width: canvasWidth, height: canvasHeight };
        if (last === null || canvasWidth === 0 || canvasHeight === 0 || fittedKey.current !== levelKey) return;
        if (last.width === canvasWidth && last.height === canvasHeight) return;
        // the lines move under the hover card and a pinned one, which were placed for the old view
        setLineHover(null);
        setPinned(null);
        if (!moved.current){
            const lines = drawnLinesBounds(openRef.current.routes, openRef.current.edges);
            void setViewport(initialViewport(boundsOf(positions), { width: canvasWidth, height: canvasHeight }, 0, lines), { duration: 0 });
        } else {
            const view = getViewport();
            void setViewport({ x: view.x + (canvasWidth - last.width) / 2, y: view.y + (canvasHeight - last.height) / 2, zoom: view.zoom }, { duration: 0 });
        }
    }, [canvasWidth, canvasHeight, levelKey, positions, setViewport, getViewport]);

    const onNodeClick: NodeMouseHandler<BoxNode> = (_, node) => onSelect(node.id);
    const onNodeDoubleClick: NodeMouseHandler<BoxNode> = (_, node) => {
        const { box } = node.data;
        if (box.kind === "folder") onOpen(node.id);
        // a portal turns to its page; the merged one stands for several, so it stays selected for its panel to pick one
        else if (box.kind === "portal" && box.page !== undefined) onTurnPage(box.page);
    };
    const onNodeMouseEnter: NodeMouseHandler<BoxNode> = (_, node) => setHoveredBox(node.id);
    const onNodeMouseLeave: NodeMouseHandler<BoxNode> = () => setHoveredBox(null);

    // The lines under the pointer (the owner, 2026-10-29): every line on the run it's on (runs.ts), named by the hover
    // card beside it (LineCard). The card stays where the pointer landed while it stays on that run, so it reads as
    // still rather than trailing the pointer, and moves only to another run, or when the pointer comes onto it.
    const drawnLines = useMemo(() => keySet(drawnKey), [drawnKey]);
    const edgeById = useMemo(() => new Map(level.edges.map((e) => [edgeKey(e), e])), [level]);
    const cardAt = useRef<CanvasRect | null>(null);
    const hoverAt = (event: { clientX: number; clientY: number }, id: string): LineHover | null => {
        const found = linesSharing(id, screenToFlowPosition({ x: event.clientX, y: event.clientY }), routes, drawnLines);
        const edge = edgeById.get(id);
        if (found === null || canvas === null || edge === undefined) return null;
        const box = canvas.getBoundingClientRect();
        const pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
        const width = lineWidth(edge.count, maxImports);
        const line = pointedBits(routes.get(id)!, pointer, getViewport(), width, arrowHead(heads.get(edge.target) ?? width));
        // what's over the canvas says so (a drawer, a box's actions, the banner: MapView, BoxActions)
        const clear = [...(canvas.parentElement ?? canvas).querySelectorAll("[data-keep-clear]")].map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
        });
        return { key: found.lines.join("\n"), lines: found.lines, pointer, line, clear };
    };
    const onEdgeMouseMove: EdgeMouseHandler = (event, edge) => {
        const next = hoverAt(event, edge.id);
        if (next === null) return;
        const card = cardAt.current;
        const onCard = card !== null && next.pointer.x >= card.left - 4 && next.pointer.x <= card.left + card.width + 4
            && next.pointer.y >= card.top - 4 && next.pointer.y <= card.top + card.height + 4;
        if (lineHover !== null && lineHover.key === next.key && !onCard) return;
        setLineHover(next);
    };
    const onEdgeMouseLeave: EdgeMouseHandler = () => setLineHover(null);
    // a click on the run pins its card where it is, listing every line (LineCard)
    const onEdgeClick: EdgeMouseHandler = (event, edge) => {
        const next = hoverAt(event, edge.id);
        if (next === null) return;
        setPinned(lineHover !== null && lineHover.key === next.key ? lineHover : next);
    };

    // A pinned card closes on Escape, a click anywhere outside it, another page (above), or the view moving under it.
    // Escape is caught first, on the way down, and stopped there, so it doesn't also let go of the selection (Explorer's
    // rail does the same). A click on the empty canvas that closes it does only that, as Escape does, rather than letting
    // go of the selection too: the click after that pointerdown is stopped before the pane sees it.
    const pinnedCard = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (pinned === null) return;
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setPinned(null);
        };
        const onPointer = (event: PointerEvent): void => {
            if (event.target instanceof Node && pinnedCard.current?.contains(event.target)) return;
            setPinned(null);
            if (!(event.target instanceof Element && event.target.closest(".react-flow__pane"))) return;
            const stop = (click: MouseEvent): void => {
                if (click.target instanceof Element && click.target.closest(".react-flow__pane")) click.stopPropagation();
            };
            document.addEventListener("click", stop, { capture: true, once: true });
            // a drag that pans has no click: the next press takes the stopper away before its own click comes
            document.addEventListener("pointerdown", () => document.removeEventListener("click", stop, { capture: true }), { capture: true, once: true });
        };
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", onPointer, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            document.removeEventListener("pointerdown", onPointer, true);
        };
    }, [pinned]);
    const card = pinned ?? lineHover;

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onPaneClick={() => onSelect(null)}
            onMoveStart={(event) => {
                if (event === null) return;
                moved.current = true;
                // the lines move under the cards, which were placed for where they were
                setLineHover(null);
                setPinned(null);
            }}
            onEdgeMouseEnter={onEdgeMouseMove}
            onEdgeMouseMove={onEdgeMouseMove}
            onEdgeMouseLeave={onEdgeMouseLeave}
            onEdgeClick={onEdgeClick}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            minZoom={0.1}
            maxZoom={2}
            colorMode={isLightKind(themeKind) ? "light" : "dark"}
            proOptions={{ hideAttribution: true }}
            inert={covered}
        >
            {/* under the lines (globals.css puts this layer beneath them): the folders' back cards, and the divider */}
            <ViewportPortal>
                <BackCards nodes={level.nodes} positions={positions} tones={emphasis.boxes} />
                {divider && <LooseDivider divider={divider} />}
            </ViewportPortal>
            {actionsFor !== null && byPath.has(actionsFor) && positions.has(actionsFor) && (
                <BoxActions
                    box={byPath.get(actionsFor)!}
                    position={positions.get(actionsFor)!}
                    onOpen={onOpen}
                    onTurnPage={onTurnPage}
                    onDetails={onDetails}
                />
            )}
            {card !== null && (
                <LineCard
                    key={`${pinned === null ? "hover" : "pinned"}\n${card.key}`}
                    words={runWords(card.lines.map((id) => edgeById.get(id)!), byPath)}
                    pointer={card.pointer}
                    line={card.line}
                    clear={card.clear}
                    pinned={pinned !== null}
                    cardRef={pinned === null ? undefined : pinnedCard}
                    placedRef={cardAt}
                />
            )}
        </ReactFlow>
    );
}

/** A back card's color: 70% of the way from the background to its front card's, so it reads as the card behind. */
const behind = (color: string): string => `color-mix(in srgb, ${color} 70%, var(--canvas))`;

/**
 * Every folder's back card, a second card 5 px behind it (the owner's pick of 2026-10-27, compare-files.png option C):
 * a folder opens into more boxes, and a file has none. Opaque, its fill and border 70% of the way from the background
 * to its own card's, faded with its card, and drawn under the lines, so a line leaving a box's bottom edge stays whole.
 */
function BackCards({ nodes, positions, tones }: {
    nodes: LevelResponse["nodes"];
    positions: ReadonlyMap<string, Position>;
    tones: ReadonlyMap<string, BoxTone>;
}){
    return (
        <div aria-hidden data-testid="back-cards" className="pointer-events-none">
            {nodes.filter((n) => n.kind === "folder").map((n) => {
                const at = positions.get(n.path);
                if (at === undefined) return null;
                const tone = tones.get(n.path) ?? "normal";
                const faded = tone === "faded";
                return (
                    <div
                        key={n.path}
                        data-back-card={n.path}
                        style={{
                            position: "absolute", left: at.x + 5, top: at.y + 5, width: BOX_WIDTH, height: BOX_HEIGHT, borderRadius: 5,
                            background: behind(shade("var(--node)", faded)), border: `1px solid ${behind(shade(borderOf(tone, false), faded))}`,
                        }}
                    />
                );
            })}
        </div>
    );
}

/**
 * The label over a level's loose boxes, "Not linked to anything here", on a hairline (levelLayout.ts's looseDivider;
 * owner's design, 2026-10-13, restyled quiet by the Workbench redesign, ADR-070). It lives in the Map's own
 * coordinates, so it pans and zooms with the boxes. A hairline in the divider's color, never ending in an arrow, so it
 * can't be read as a line between boxes.
 */
function LooseDivider({ divider }: { divider: Divider }){
    return (
        <div
            data-testid="loose-divider"
            aria-hidden
            style={{ position: "absolute", left: divider.x, top: divider.y - 11, width: divider.width, height: 22 }}
            className="pointer-events-none flex items-center gap-3"
        >
            <span className="h-px flex-1 bg-divider" />
            <span className="whitespace-nowrap text-[12px] text-text-3">Not linked to anything here</span>
            <span className="h-px flex-1 bg-divider" />
        </div>
    );
}

// memo: the Map's clock ticks while Claude Code is active, and the canvas shouldn't redraw for it
export default memo(MapCanvas);
