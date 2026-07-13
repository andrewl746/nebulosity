"use client";

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import FileNode, { type FileNodeType } from "./FileNode";

// Defined at module scope — recreating this object per render would make
// React Flow remount every node on each render.
const nodeTypes: NodeTypes = { file: FileNode };

type GraphCanvasProps = {
  nodes: FileNodeType[];
  edges: Edge[];
};

export default function GraphCanvas({ nodes, edges }: GraphCanvasProps) {
  return (
    <ReactFlow
      defaultNodes={nodes}
      defaultEdges={edges}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
      // Extra left/top padding keeps the fitted graph clear of the flush
      // terminal panel (w-80 = 320px) and the top status bar (36px).
      fitViewOptions={{
        padding: { left: "340px", top: "56px", right: "48px", bottom: "48px" },
      }}
      className="!bg-transparent"
    >
      <Background
        // Dark mode paints an opaque #141414 here by default, which would
        // hide the StarField and nebula layers underneath the canvas.
        bgColor="transparent"
        variant={BackgroundVariant.Lines}
        gap={48}
        lineWidth={0.5}
        color="rgba(157, 80, 221, 0.12)"
      />
      <Controls
        position="bottom-right"
        className="!rounded-none !border !border-purple-500/20 !bg-[#0c0716]/80 !shadow-none backdrop-blur-xl"
      />
      <MiniMap
        position="top-right"
        pannable
        zoomable
        className="!h-28 !w-44 !rounded-none !border !border-purple-500/20 !bg-[#0c0716]/80"
        maskColor="rgba(6, 7, 11, 0.75)"
        nodeColor="rgba(168, 85, 247, 0.5)"
      />
    </ReactFlow>
  );
}
