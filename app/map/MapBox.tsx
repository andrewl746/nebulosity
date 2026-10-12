"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { MapNode } from "@/lib/contracts";
import { formatCount } from "./format";

/** What a box carries besides React Flow's own fields. */
export type BoxData = {
    box: MapNode;
    selected: boolean;
    highlighted: boolean;
    /** Changes when a tool call touches this box: the pulse ring remounts and plays again. */
    pulseKey: number;
};

export type BoxNode = Node<BoxData, "box">;

const PLACEHOLDERS: Partial<Record<MapNode["summaryStatus"], string>> = {
    pending: "summary pending",
    failed: "summary failed",
    off: "no summary (no API key)",
};

/**
 * One box on the Map (PIVOT_SPEC.md §7): its name, how many files it holds, and its tagline, or a quiet placeholder
 * while there's none. An out-of-date tagline is dimmed. "+N more" is drawn dashed; selecting it lists what it folds.
 */
function MapBox({ data }: NodeProps<BoxNode>){
    const { box, selected, highlighted, pulseKey } = data;
    const more = box.kind === "more";
    const border = selected ? "border-purple-300 shadow-[0_0_18px_rgba(168,85,247,0.55)]"
        : highlighted ? "border-cyan-300/80 shadow-[0_0_14px_rgba(34,211,238,0.35)]"
        : more ? "border-dashed border-purple-400/35"
        : "border-purple-400/25";
    const current = Boolean(box.tagline) && box.summaryStatus !== "stale";

    return (
        <div
            data-box={box.path}
            title={box.path || box.name}
            className={`relative h-[76px] w-[224px] rounded-sm border bg-black/60 px-3 py-2 font-mono backdrop-blur-md transition-colors ${border}`}
        >
            {pulseKey > 0 && <span key={pulseKey} aria-hidden className="neb-pulse pointer-events-none absolute inset-0 rounded-sm" />}
            <div className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-[12px] ${more ? "text-purple-200/80" : "text-zinc-100"}`}>
                    {box.name}{box.kind === "folder" ? "/" : ""}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">{box.kind === "file" ? "file" : `${formatCount(box.fileCount)} files`}</span>
            </div>
            <p className={`mt-1 line-clamp-2 text-[10.5px] leading-snug ${current ? "text-zinc-400" : "italic text-zinc-600"}`}>
                {more ? "select to list them" : box.tagline ?? PLACEHOLDERS[box.summaryStatus] ?? ""}
            </p>
            <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-purple-400/40" />
            <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-purple-400/40" />
        </div>
    );
}

// memo: React Flow re-renders nodes on every pan and zoom otherwise
export default memo(MapBox);
