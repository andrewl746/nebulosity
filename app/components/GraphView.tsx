"use client"

import { useState, useEffect } from "react";
import GraphCanvas from "./GraphCanvas";
import { useGraphControls } from "@/app/hooks/useGraphControls";
import { ReactFlowProvider } from "@xyflow/react";
import type { GraphResponse } from "@/lib/contracts";

function GraphViewInner(){
    const [graph, setGraph] = useState<GraphResponse | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { highlightedNodeIds, highlight, clearHighlights, focusNode } = useGraphControls();

    useEffect(() => {
        fetch("/api/graph")
            .then(res => res.json())
            .then(data => setGraph(data));
    }, []);

    if (!graph){
        return <div>Loading...</div>
    }

    const selectedNode = graph.nodes.find(n => n.id === selectedId);
    const outDegree = graph.edges.filter(e => e.source === selectedId).length;
    const inDegree = graph.edges.filter(e => e.target === selectedId).length;

    return (
        <>
            <main className="absolute inset-0">
                <GraphCanvas nodes={graph.nodes} edges={graph.edges} onNodeSelect={setSelectedId} onDeselect={() => setSelectedId(null)} highlightedNodeIds={highlightedNodeIds}/>
            </main>

            {/* Observed-sector status bar */}
            <div className="pointer-events-auto absolute inset-x-0 top-0 flex h-9 items-center justify-center border-b border-purple-500/15 bg-[#06070B]/40 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-cyan-300/80" />
                <span className="font-mono text-[10px] font-light uppercase tracking-[0.3em] text-zinc-400">
                    observing <span className="text-zinc-200">~/{graph.stats.rootName}</span>
                </span>
                <span className="font-mono text-xs text-zinc-300">
                    {graph.nodes.length} Files · {graph.edges.length} Links
                </span>
                </div>
            </div>

            <button onClick={() => highlight(["lib/graph.ts"])} className="pointer-events-auto absolute top-12 right-4 z-50 bg-purple-600 px-2 py-1 text-xs text-white">
                Highlight graph.ts
            </button>

            <button onClick={() => clearHighlights()} className="pointer-events-auto absolute top-20 right-4 z-50 bg-purple-600 px-2 py-1 text-xs text-white">Clear</button>

            <button onClick={() => focusNode("lib/graph.ts")} className="pointer-events-auto absolute top-28 right-4 z-50 bg-purple-600 px-2 py-1 text-xs text-white">Focus Node</button>


            {selectedNode && (
                <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 border border-purple-500/20 bg-[#0c0716]/80 px-4 py-2 backdrop-blur-xl">
                    <span
                        className={`h-1 w-1 rounded-full ${
                            selectedNode.data.kind === "component" ? "bg-cyan-300/80" : "bg-purple-400/80"
                        }`}
                    />
                    <span className="font-mono text-xs text-zinc-200">{selectedNode.id}</span>
                    <span className="font-mono text-[10px] font-light uppercase tracking-[0.3em] text-zinc-400">{selectedNode.data.kind}</span> {/*kind: component/module*/}
                    <span className="font-mono text-xs text-zinc-300">Imports {outDegree} · Imported by {inDegree}</span>
                </div>
            )}
        </>
    );
}

export default function GraphView(){
    return(
        <ReactFlowProvider>
            <GraphViewInner />
        </ReactFlowProvider>
    );
}