"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Background, BackgroundVariant, Controls, MarkerType, ReactFlow, useEdgesState, useNodesState, useReactFlow,
    type Edge, type EdgeMouseHandler, type NodeMouseHandler, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LevelResponse } from "@/lib/contracts";
import { edgeOpacity, edgeWidth } from "./edges";
import { formatCount } from "./format";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel } from "./levelLayout";
import MapBox, { type BoxNode } from "./MapBox";
import type { Pulse } from "./pulses";

// at module scope: a new object per render would make React Flow remount every box
const nodeTypes: NodeTypes = { box: MapBox };

type MapCanvasProps = {
    level: LevelResponse;
    selected: string | null;
    /** Boxes a show_on_map highlight points at (Task 20). */
    highlighted: ReadonlySet<string>;
    pulses: ReadonlyMap<string, Pulse>;
    onSelect: (path: string | null) => void;
    onOpen: (folder: string) => void;
    /** Called once a new level is on screen (S3's measuring point). */
    onDrawn: () => void;
};

/**
 * The canvas (PIVOT_SPEC.md §7): one level's boxes, laid out by dagre, and the lines between them. A click selects
 * and a double-click opens a folder. The selected box's lines are drawn at full strength, the rest ghosted, and
 * hovering a line shows its count. React Flow stays controlled with the StrictMode workaround in next.config.ts.
 */
export default function MapCanvas({ level, selected, highlighted, pulses, onSelect, onOpen, onDrawn }: MapCanvasProps){
    const positions = useMemo(() => layoutLevel(level.nodes, level.edges), [level]);
    const maxCount = useMemo(() => Math.max(0, ...level.edges.map((e) => e.count)), [level]);
    const [hovered, setHovered] = useState<string | null>(null);
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
            data: { box, selected: box.path === selected, highlighted: highlighted.has(box.path), pulseKey: pulses.get(box.path)?.key ?? 0 },
        })));
    }, [level, positions, selected, highlighted, pulses, setNodes]);

    useEffect(() => {
        setEdges(level.edges.map((edge) => {
            const id = `${edge.source}->${edge.target}`;
            const stroke = `rgba(168, 85, 247, ${edgeOpacity(edge, selected)})`;
            return {
                id,
                source: edge.source,
                target: edge.target,
                focusable: false,
                label: hovered === id ? `${formatCount(edge.count)} import${edge.count === 1 ? "" : "s"}` : undefined,
                labelStyle: { fill: "#e4e4e7", fontSize: 11 },
                labelBgStyle: { fill: "#0c0716", fillOpacity: 0.9 },
                style: { stroke, strokeWidth: edgeWidth(edge.count, maxCount) },
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
            };
        }));
    }, [level, selected, hovered, maxCount, setEdges]);

    // A new level (another folder, or another repo): fit it to the screen, then report it drawn. The same level
    // refetched after the index moved is a new object with the same key, so the user's pan and zoom stay put.
    const levelKey = `${level.repo}\n${level.path}`;
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            void fitViewRef.current({ padding: 0.12, duration: 0 });
            onDrawnRef.current();
        });
        return () => cancelAnimationFrame(frame);
    }, [levelKey]);

    const onNodeClick: NodeMouseHandler<BoxNode> = (_, node) => onSelect(node.id);
    const onNodeDoubleClick: NodeMouseHandler<BoxNode> = (_, node) => {
        if (node.data.box.kind === "folder") onOpen(node.id);
    };
    const onEdgeMouseEnter: EdgeMouseHandler = (_, edge) => setHovered(edge.id);
    const onEdgeMouseLeave: EdgeMouseHandler = () => setHovered(null);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={() => onSelect(null)}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            minZoom={0.1}
            maxZoom={2}
            colorMode="dark"
            className="!bg-transparent"
        >
            <Background bgColor="transparent" variant={BackgroundVariant.Lines} gap={48} lineWidth={0.5} color="rgba(157, 80, 221, 0.10)" />
            <Controls
                position="bottom-right"
                showInteractive={false}
                className="!rounded-none !border !border-purple-500/20 !bg-[#0c0716]/80 !shadow-none backdrop-blur-xl"
            />
        </ReactFlow>
    );
}
