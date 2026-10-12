"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    ControlButton, Controls, MarkerType, ReactFlow, useEdgesState, useNodesState, useReactFlow,
    type Edge, type EdgeMouseHandler, type NodeMouseHandler, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { IconFocusCentered } from "@tabler/icons-react";
import type { LevelResponse } from "@/lib/contracts";
import { edgeKey, mapEmphasis, type EdgeTone } from "./emphasis";
import { formatCount } from "./format";
import Legend from "./Legend";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel } from "./levelLayout";
import MapBox, { type BoxNode } from "./MapBox";
import type { Pulse } from "./pulses";

// at module scope: a new object per render would make React Flow remount every box
const nodeTypes: NodeTypes = { box: MapBox };

/** A level fits the screen with room around it, and a small level isn't blown up past 100% (VISUAL_REFRESH.md §4). */
const FIT = { padding: 0.15, maxZoom: 1 } as const;

/** Each line's look per tone (VISUAL_REFRESH.md §4): 1 px slate normally, 2 px purple for the selection's links. */
const EDGE_STYLES: Record<EdgeTone, { stroke: string; width: number; opacity: number; layer: number }> = {
    normal: { stroke: "var(--neutral-edge)", width: 1, opacity: 1, layer: 0 },
    faded: { stroke: "var(--neutral-edge)", width: 1, opacity: 0.35, layer: 0 },
    preview: { stroke: "var(--text-2)", width: 1.5, opacity: 1, layer: 1 },
    selected: { stroke: "var(--select)", width: 2, opacity: 1, layer: 2 },
};

type MapCanvasProps = {
    level: LevelResponse;
    selected: string | null;
    /** Boxes Claude Code is touching right now: recent tool calls and show_on_map highlights. */
    agent: ReadonlySet<string>;
    pulses: ReadonlyMap<string, Pulse>;
    onSelect: (path: string | null) => void;
    onOpen: (folder: string) => void;
    /** Called once a new level is on screen (S3's measuring point). */
    onDrawn: () => void;
};

/**
 * The canvas (VISUAL_REFRESH.md §4): one level's boxes, laid out by dagre, and an arrow for every import line. A
 * click selects and a double click opens a folder. The selection's lines turn purple and unrelated boxes fade;
 * hovering a box previews its lines without selecting it, and hovering a line shows its count. React Flow stays
 * controlled with the StrictMode workaround in next.config.ts.
 */
function MapCanvas({ level, selected, agent, pulses, onSelect, onOpen, onDrawn }: MapCanvasProps){
    const positions = useMemo(() => layoutLevel(level.nodes, level.edges), [level]);
    const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
    const [hoveredBox, setHoveredBox] = useState<string | null>(null);
    const emphasis = useMemo(
        () => mapEmphasis(level.nodes.map((n) => n.path), level.edges, selected, hoveredBox),
        [level, selected, hoveredBox],
    );
    const [nodes, setNodes, onNodesChange] = useNodesState<BoxNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const { fitView } = useReactFlow();
    // the latest fitView and onDrawn, for the fit below: it runs when the level changes, not when they do
    const fitViewRef = useRef(fitView);
    const onDrawnRef = useRef(onDrawn);
    useEffect(() => {
        fitViewRef.current = fitView;
        onDrawnRef.current = onDrawn;
    }, [fitView, onDrawn]);

    useEffect(() => {
        setNodes(level.nodes.map((box) => ({
            id: box.path,
            type: "box" as const,
            position: positions.get(box.path) ?? { x: 0, y: 0 },
            width: BOX_WIDTH,
            height: BOX_HEIGHT,
            draggable: false,
            connectable: false,
            data: { box, tone: emphasis.boxes.get(box.path) ?? "normal", agent: agent.has(box.path), pulseKey: pulses.get(box.path)?.key ?? 0 },
        })));
    }, [level, positions, emphasis, agent, pulses, setNodes]);

    useEffect(() => {
        const drawn = level.edges.map((edge) => {
            const id = edgeKey(edge);
            const look = EDGE_STYLES[emphasis.edges.get(id) ?? "normal"];
            return {
                id,
                source: edge.source,
                target: edge.target,
                focusable: false,
                zIndex: look.layer,
                label: hoveredEdge === id ? `${formatCount(edge.count)} import${edge.count === 1 ? "" : "s"}` : undefined,
                labelStyle: { fill: "var(--text)", fontSize: 12 },
                labelBgStyle: { fill: "var(--surface)" },
                labelBgPadding: [6, 3] as [number, number],
                labelBgBorderRadius: 6,
                style: { stroke: look.stroke, strokeWidth: look.width, opacity: look.opacity },
                // userSpaceOnUse: the arrowhead stays the same size whatever the line's width
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: look.stroke, markerUnits: "userSpaceOnUse" },
            };
        });
        // the emphasized lines go last, so they're drawn over the quiet ones they cross
        setEdges(drawn.sort((a, b) => a.zIndex - b.zIndex));
    }, [level, emphasis, hoveredEdge, setEdges]);

    // A new level (another folder, or another repo): fit it to the screen, then report it drawn. The boxes reach React
    // Flow a render after the level does (setNodes runs in an effect), so the fit waits until `nodes` holds this
    // level's boxes: fitting sooner frames the previous level's, which is what a level from the cache got. The same
    // level refetched after the index moved keeps its key, so the user's pan and zoom stay put.
    const levelKey = `${level.repo}\n${level.path}`;
    const fittedKey = useRef<string | null>(null);
    useEffect(() => {
        if (fittedKey.current === levelKey) return;
        const arrived = nodes.length === level.nodes.length && nodes.every((node, i) => node.id === level.nodes[i].path);
        if (!arrived) return;
        const frame = requestAnimationFrame(() => {
            fittedKey.current = levelKey;
            void fitViewRef.current({ ...FIT, duration: 0 });
            onDrawnRef.current();
        });
        return () => cancelAnimationFrame(frame);
    }, [levelKey, nodes, level.nodes]);

    const onNodeClick: NodeMouseHandler<BoxNode> = (_, node) => onSelect(node.id);
    const onNodeDoubleClick: NodeMouseHandler<BoxNode> = (_, node) => {
        if (node.data.box.kind === "folder") onOpen(node.id);
    };
    const onNodeMouseEnter: NodeMouseHandler<BoxNode> = (_, node) => setHoveredBox(node.id);
    const onNodeMouseLeave: NodeMouseHandler<BoxNode> = () => setHoveredBox(null);
    const onEdgeMouseEnter: EdgeMouseHandler = (_, edge) => setHoveredEdge(edge.id);
    const onEdgeMouseLeave: EdgeMouseHandler = () => setHoveredEdge(null);
    /** Reset focus (§4): let go of the selection and the fade it brings. */
    const resetFocus = (): void => {
        setHoveredBox(null);
        onSelect(null);
    };

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onPaneClick={() => onSelect(null)}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            minZoom={0.1}
            maxZoom={2}
            colorMode="dark"
        >
            <Legend />
            <Controls position="bottom-right" showInteractive={false} fitViewOptions={FIT} className="overflow-hidden rounded-lg border border-border">
                <ControlButton onClick={resetFocus} title="Reset focus" aria-label="Reset focus">
                    <IconFocusCentered aria-hidden size={16} stroke={1.75} />
                </ControlButton>
            </Controls>
        </ReactFlow>
    );
}

// memo: the Map's clock ticks while Claude Code is active, and the canvas shouldn't redraw for it
export default memo(MapCanvas);
