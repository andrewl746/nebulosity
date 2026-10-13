"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { IconDots, IconFile, IconFolder } from "@tabler/icons-react";
import type { MapNode } from "@/lib/contracts";
import type { BoxTone } from "./emphasis";
import { formatCount } from "./format";

/** What a box carries besides React Flow's own fields. */
export type BoxData = {
    box: MapNode;
    tone: BoxTone;
    /** Claude Code is touching what this box holds right now (VISUAL_REFRESH.md §4: an orange ring). */
    agent: boolean;
    /** Changes when a tool call touches this box: the pulse ring remounts and plays again. */
    pulseKey: number;
};

export type BoxNode = Node<BoxData, "box">;

/**
 * Fill, border and opacity per tone. The selected box's border is 2 px, so its padding is 1 px less and its content
 * doesn't shift when it's selected.
 */
const TONES: Record<BoxTone, string> = {
    normal: "border border-border bg-surface px-3",
    linked: "border border-border bg-surface px-3",
    preview: "border border-text-2 bg-surface px-3",
    selected: "border-2 border-select bg-select-fill px-[11px]",
    faded: "border border-border bg-surface px-3 opacity-60",
};

/**
 * One box on the Map (VISUAL_REFRESH.md §4): an outline icon, the name, and for folders how many files they hold.
 * Summaries live in the panel, not here. "+N more" is drawn dashed; selecting it lists what it folds.
 */
function MapBox({ data }: NodeProps<BoxNode>){
    const { box, tone, agent, pulseKey } = data;
    const Icon = box.kind === "folder" ? IconFolder : box.kind === "file" ? IconFile : IconDots;

    return (
        <div
            data-box={box.path}
            data-tone={tone}
            title={box.path || box.name}
            className={`relative flex h-[64px] w-[232px] items-center gap-2 rounded-lg ${TONES[tone]} ${box.kind === "portal" ? "border-dashed" : ""} ${agent ? "outline-2 outline-offset-2 outline-agent" : ""}`}
        >
            {pulseKey > 0 && <span key={pulseKey} aria-hidden className="neb-pulse pointer-events-none absolute inset-0 rounded-lg" />}
            <Icon aria-hidden size={16} stroke={1.75} className={`shrink-0 ${box.kind === "folder" ? "text-folder" : "text-text-2"}`} />
            <div className="min-w-0">
                <div className="truncate text-[15px] font-medium leading-5 text-text">{box.name}</div>
                {box.kind !== "file" && (
                    <div className="text-[12px] leading-4 text-text-2">{formatCount(box.fileCount)} {box.fileCount === 1 ? "file" : "files"}</div>
                )}
            </div>
            {/* the lines attach here; they carry the direction, so the handles stay out of sight */}
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
        </div>
    );
}

// memo: React Flow re-renders nodes on every pan and zoom otherwise
export default memo(MapBox);
