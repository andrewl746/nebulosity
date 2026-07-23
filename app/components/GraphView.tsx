"use client"

import { useState, useEffect } from "react";
import GraphCanvas from "./GraphCanvas";
import type { GraphResponse } from "@/lib/contracts";

export default function GraphView(){
    const [graph, setGraph] = useState<GraphResponse | null>(null);

    useEffect(() => {
        fetch("/api/graph")
            .then(res => res.json())
            .then(data => setGraph(data));
    }, []);

    if (!graph){
        return <div>Loading...</div>
    }

    return (
        <>
            <main className="absolute inset-0">
                <GraphCanvas nodes={graph.nodes} edges={graph.edges} />
            </main>

            {/* Observed-sector status bar */}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex h-9 items-center justify-center border-b border-purple-500/15 bg-[#06070B]/40 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-cyan-300/80" />
                <span className="font-mono text-[10px] font-extralight uppercase tracking-[0.3em] text-zinc-400">
                    observing <span className="text-zinc-200">~/{graph.stats.rootName}</span>
                </span>
                <span className="font-mono text-[10px] font-extralight text-zinc-600">
                    {graph.nodes.length} Files · {graph.edges.length} Links
                </span>
                </div>
            </div>
        </>
    );
}