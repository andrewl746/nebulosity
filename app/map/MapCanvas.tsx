"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    ReactFlow, useEdgesState, useNodesState, useReactFlow, useStore, ViewportPortal,
    type EdgeMouseHandler, type EdgeTypes, type NodeMouseHandler, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LevelResponse } from "@/lib/contracts";
import BoxActions from "./BoxActions";
import { edgeKey, lineLook, mapEmphasis, type BoxTone } from "./emphasis";
import { reuseUnchanged, sameBoxNode, sameRoutedEdge, toBoxNode } from "./flowNodes";
import { formatCount } from "./format";
import { lineLabel } from "./labels";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, looseDivider, perRowFor, type Divider, type Position } from "./levelLayout";
import MapBox, { borderOf, shade, type BoxData, type BoxNode } from "./MapBox";
import { portalCaption, portalDirection, portalLinks, portalTitle } from "./portals";
import type { Pulse } from "./pulses";
import RoutedEdge, { type RoutedEdgeType } from "./RoutedEdge";
import { nextRoutes, routeEdges } from "./routes";
import { isLightKind } from "./theme";
import { useThemeKind } from "./useThemeKind";
import { boundsOf, drawnLinesBounds, initialViewport } from "./viewport";
import { boxHeadWidths, dotSize, labelledLines, lineWidth, maxFilesOf, maxImportsOf } from "./weights";

/** The line ids a key of ids joined by newlines names. */
const keySet = (key: string): Set<string> => new Set(key === "" ? [] : key.split("\n"));

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
 * hovering a box previews its lines without selecting it, and hovering a line shows its count. React Flow stays
 * controlled with the StrictMode workaround in next.config.ts.
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
    const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
    const [hoveredBox, setHoveredBox] = useState<string | null>(null);
    // A hover belongs to the level it happened on. Going into a folder unmounts the old boxes before their mouseleave
    // fires, so the hover outlived the level, and coming back (a cached level, the same object as before) lit that box
    // up with nothing under the pointer (deferred minor). So it's cleared whenever another level is drawn: React's way
    // to reset state when a prop changes, during render rather than in an effect, so no frame shows the stale hover.
    const [drawnLevel, setDrawnLevel] = useState(level);
    if (drawnLevel !== level){
        setDrawnLevel(level);
        setHoveredBox(null);
        setHoveredEdge(null);
    }
    const emphasis = useMemo(
        // the boxes Claude Code or the editor has lit keep their lines, whatever hides the rest
        () => mapEmphasis(level.nodes.map((n) => n.path), level.edges, selected, hoveredBox, { quietLines, strongOnly, pinned: agent }),
        [level, selected, hoveredBox, quietLines, strongOnly, agent],
    );
    // The lines drawn at rest (nothing selected, hovered or lit) are routed once, among themselves (routes.ts). A line a
    // selection, a hover or a lit box adds is routed when it appears, around every line on screen, and keeps that route
    // while it stays, so pointing at a box or clicking one never moves a line that's drawn (the owner, 2026-10-27).
    // Keyed by content: a hover that draws the same lines keeps every route.
    const restKey = useMemo(() => {
        const rest = mapEmphasis(level.nodes.map((n) => n.path), level.edges, null, null, { quietLines, strongOnly });
        return level.edges.map(edgeKey).filter((id) => rest.edges.get(id) !== "hidden").join("\n");
    }, [level, quietLines, strongOnly]);
    const restRoutes = useMemo(() => routeEdges(positions, level.edges, keySet(restKey)), [positions, level, restKey]);
    const drawnKey = level.edges.map(edgeKey).filter((id) => emphasis.edges.get(id) !== "hidden").join("\n");
    // what's on screen, and what it was routed from: React's way to keep state that follows a prop, set during render
    const [shown, setShown] = useState({ rest: restRoutes, drawn: restKey, routes: restRoutes });
    if (shown.rest !== restRoutes || shown.drawn !== drawnKey){
        const before = shown.rest === restRoutes ? shown.routes : restRoutes;
        setShown({ rest: restRoutes, drawn: drawnKey, routes: nextRoutes(positions, level.edges, restRoutes, before, keySet(drawnKey)) });
    }
    const routes = shown.routes;
    const [nodes, setNodes, onNodesChange] = useNodesState<BoxNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<RoutedEdgeType>([]);
    const { setViewport, getViewport } = useReactFlow();
    const canvasWidth = useStore((s) => s.width);
    const canvasHeight = useStore((s) => s.height);
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
                    // the page's heaviest lines and the selection's carry their count, the selection's in the text color
                    count: labelled.has(id) ? formatCount(edge.count) : undefined,
                    countStrong: tone === "selected",
                },
                source: edge.source,
                target: edge.target,
                focusable: false,
                // in words ("editor uses base, 12 imports"): the three-task test's tester read an arrow backwards
                label: hoveredEdge === id ? lineLabel(byPath.get(edge.source)!, byPath.get(edge.target)!, edge.count) : undefined,
            };
            return [{ layer: look.layer, edge: drawnEdge }];
        });
        // the emphasized lines go last, so they're drawn over the quiet ones they cross or share a run with. Order, not
        // zIndex: React Flow lifts an edge with a zIndex above every box, where it would take the box's clicks (final
        // review I2)
        const next = drawn.sort((a, b) => a.layer - b.layer).map((d) => d.edge);
        setEdges((previous) => reuseUnchanged(previous, next, sameRoutedEdge));
    }, [level, byPath, routes, emphasis, selected, hoveredEdge, maxImports, heads, labelled, setEdges]);

    // A new level (another folder, or another repo): open it at a readable size (viewport.ts: fitted, its drawn lines
    // too where the boxes keep their size, unless that would shrink it past 75%, then from its top), then report it
    // drawn. The boxes reach React Flow a render after the level does (setNodes runs in an effect), so this waits until
    // `nodes` holds this level's boxes: placing the view sooner frames the previous level's, which is what a level from
    // the cache got. The same level refetched after the index moved keeps its key, so the user's pan and zoom stay put.
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
    const onEdgeMouseEnter: EdgeMouseHandler = (_, edge) => setHoveredEdge(edge.id);
    const onEdgeMouseLeave: EdgeMouseHandler = () => setHoveredEdge(null);

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
            onMoveStart={(event) => { if (event !== null) moved.current = true; }}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
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
