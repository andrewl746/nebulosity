"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { IconArrowLeft, IconArrowRight, IconStack2 } from "@tabler/icons-react";
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
    /** The dot's diameter in px, by how many files the box holds against the page's largest folder (weights.ts). */
    dot: number;
    /** Portals only: which way the doorway leads, "Lines to page 2", and "44 folders and files, 6 imports" under it (portals.ts). */
    portal?: { direction: "previous" | "next" | "many"; title: string; caption: string };
};

export type BoxNode = Node<BoxData, "box">;

/**
 * A color as a box away from the selection draws it: mixed toward the background, keeping `--fade` of itself (50%, 70%
 * on high contrast), never see-through, so a folder's back card can't show through the card in front of it (the
 * owner, 2026-10-27).
 */
export function shade(color: string, faded: boolean): string {
    return faded ? `color-mix(in srgb, ${color} var(--fade), var(--canvas))` : color;
}

/** A box's border by its tone: the accent for the selection, a step toward it for what's linked to it. */
export function borderOf(tone: BoxTone, portal: boolean): string {
    if (tone === "selected") return "var(--accent)";
    if (tone === "linked") return "var(--linked-border)";
    return tone === "preview" || portal ? "var(--text-3)" : "var(--border)";
}

const PORTAL_ICONS = { previous: IconArrowLeft, next: IconArrowRight, many: IconStack2 } as const;

/**
 * The glyph slot at a box's left (the Workbench redesign, ADR-070): a folder's dot, sized by its files; a file's page,
 * its corner folded; and for the selection the logo's core, its white center in a purple ring. What's linked to the
 * selection takes the logo's lilac.
 */
function Glyph({ box, tone, dot }: Pick<BoxData, "box" | "tone" | "dot">){
    const faded = tone === "faded";
    const color = shade(tone === "linked" ? "var(--linked-glyph)" : tone === "preview" ? "var(--text-2)" : "var(--glyph-dim)", faded);
    return (
        <svg aria-hidden width={24} height={24} viewBox="0 0 24 24" className="absolute left-[12px] top-[16px]">
            {tone === "selected"
                ? <circle cx={12} cy={12} r={dot / 2} fill="var(--core)" stroke="var(--accent)" strokeWidth={3} />
                : box.kind === "folder"
                    ? <circle cx={12} cy={12} r={dot / 2} fill={color} />
                    : <path d="M7 5 h6 l4 4 v10 h-10 z M13 5 v4 h4" fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />}
        </svg>
    );
}

/**
 * One box on the Map (the Workbench redesign, ADR-070): the glyph slot, the name in mono, and for a folder how many
 * files it holds, right-aligned. Every box is 232 × 56 (levelLayout.ts); a folder's back card, the hint that it opens
 * into more boxes, is drawn by the canvas under the lines (MapCanvas's BackCards). Summaries live in the inspector, not
 * here. A portal, the doorway to another page of a big folder, is dashed and unfilled, titled by where its lines go
 * ("Lines to page 2"), with an arrow toward its page (a stack for several) and how many boxes and imports are behind
 * it; double-clicking it turns to that page.
 */
function MapBox({ data }: NodeProps<BoxNode>){
    const { box, tone, agent, pulseKey, portal, dot } = data;
    const faded = tone === "faded";
    const selected = tone === "selected";
    const title = portal
        ? `${portal.title}, ${portal.caption}. ${portal.direction === "many" ? "Select it to pick a page." : "Double-click to go there."}`
        : boxTitle(box);
    const fill = selected ? "var(--node-sel)" : portal ? "transparent" : shade("var(--node)", faded);
    const PortalIcon = portal ? PORTAL_ICONS[portal.direction] : null;

    return (
        <div
            data-box={box.path}
            data-tone={tone}
            title={title}
            style={{ background: fill }}
            className={`relative h-[56px] w-[232px] rounded-[5px] ${agent ? "outline-2 outline-offset-2 outline-agent" : ""}`}
        >
            {pulseKey > 0 && <span key={pulseKey} aria-hidden className="neb-pulse pointer-events-none absolute inset-0 rounded-[5px]" />}
            {/* the border is its own layer, so a selected box's thicker one never moves what's inside */}
            <span
                aria-hidden
                style={{ borderColor: shade(borderOf(tone, portal !== undefined), faded), borderWidth: selected ? 1.5 : 1 }}
                className={`pointer-events-none absolute inset-0 rounded-[5px] ${portal ? "border-dashed" : "border-solid"}`}
            />
            {PortalIcon
                ? <PortalIcon aria-hidden size={16} stroke={1.75} className="absolute left-[16px] top-[20px]" style={{ color: shade("var(--text-3)", faded) }} />
                : <Glyph box={box} tone={tone} dot={dot} />}
            {portal
                ? (
                    <div className="absolute inset-y-0 left-[44px] right-[14px] flex flex-col justify-center">
                        <div className="truncate text-[13px] font-medium leading-[18px]" style={{ color: shade("var(--text)", faded) }}>{portal.title}</div>
                        <div className="truncate text-[11.5px] leading-4" style={{ color: shade("var(--text-3)", faded) }}>{portal.caption}</div>
                    </div>
                )
                : (
                    <div className="absolute inset-y-0 left-[44px] right-[14px] flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" style={{ color: shade("var(--text)", faded) }}>{box.name}</span>
                        {box.kind === "folder" && (
                            <span className="shrink-0 text-[11.5px] tabular-nums" style={{ color: shade("var(--text-2)", faded) }}>{formatCount(box.fileCount)}</span>
                        )}
                    </div>
                )}
            {/* the lines attach here; they carry the direction, so the handles stay out of sight */}
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
        </div>
    );
}

// memo: React Flow re-renders nodes on every pan and zoom otherwise
export default memo(MapBox);
