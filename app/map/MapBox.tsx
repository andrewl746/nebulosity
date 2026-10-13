"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { IconArrowLeft, IconArrowRight, IconFile, IconFolder, IconStack2 } from "@tabler/icons-react";
import type { MapNode } from "@/lib/contracts";
import type { BoxTone } from "./emphasis";
import { formatCount } from "./format";
import { boxTitle } from "./labels";

/** What a box carries besides React Flow's own fields. */
export type BoxData = {
    box: MapNode;
    tone: BoxTone;
    /** Claude Code is touching what this box holds right now (VISUAL_REFRESH.md §4: an orange ring). */
    agent: boolean;
    /** Changes when a tool call touches this box: the pulse ring remounts and plays again. */
    pulseKey: number;
    /** Portals only: which way the doorway leads, "Lines to page 2", and "44 folders and files · 6 links" under it (portals.ts). */
    portal?: { direction: "previous" | "next" | "many"; title: string; caption: string };
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
 * A portal, a doorway to another page, is dashed and unfilled, the dot grid showing through, its border a step brighter
 * than a box's so it reads as a way out rather than a folder (owner pick, 2026-10-13). Selected, it fills like any box.
 */
const PORTAL_TONES: Record<BoxTone, string> = {
    normal: "border border-dashed border-text-2 bg-transparent px-3",
    linked: "border border-dashed border-text-2 bg-transparent px-3",
    preview: "border border-dashed border-text bg-transparent px-3",
    selected: "border-2 border-dashed border-select bg-select-fill px-[11px]",
    faded: "border border-dashed border-text-2 bg-transparent px-3 opacity-60",
};

const PORTAL_ICONS = { previous: IconArrowLeft, next: IconArrowRight, many: IconStack2 } as const;

/**
 * One box on the Map (VISUAL_REFRESH.md §4): an outline icon, the name, and for folders how many files they hold.
 * Summaries live in the panel, not here. A portal, the doorway to another page of a big folder, is dashed and unfilled,
 * titled by where its lines go ("Lines to page 2"), with an arrow toward its page (a stack for several) and how many
 * boxes and links are behind it; double-clicking it turns to that page.
 */
function MapBox({ data }: NodeProps<BoxNode>){
    const { box, tone, agent, pulseKey, portal } = data;
    const Icon = portal ? PORTAL_ICONS[portal.direction] : box.kind === "folder" ? IconFolder : IconFile;
    const title = portal
        ? `${portal.title}: ${portal.caption}. ${portal.direction === "many" ? "Select it to pick a page." : "Double-click to go there."}`
        : boxTitle(box);

    return (
        <div
            data-box={box.path}
            data-tone={tone}
            title={title}
            className={`relative flex h-[56px] w-[232px] items-center gap-2 rounded-lg ${portal ? PORTAL_TONES[tone] : TONES[tone]} ${agent ? "outline-2 outline-offset-2 outline-agent" : ""}`}
        >
            {pulseKey > 0 && <span key={pulseKey} aria-hidden className="neb-pulse pointer-events-none absolute inset-0 rounded-lg" />}
            <Icon aria-hidden size={16} stroke={1.75} className={`shrink-0 ${box.kind === "folder" ? "text-folder" : "text-text-2"}`} />
            <div className="min-w-0">
                <div className="truncate text-[15px] font-medium leading-5 text-text">{portal ? portal.title : box.name}</div>
                {portal && <div className="truncate text-[12px] leading-4 text-text-2">{portal.caption}</div>}
                {box.kind === "folder" && (
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
