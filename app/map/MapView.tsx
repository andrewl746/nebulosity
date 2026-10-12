"use client";

import { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { LevelResponse } from "@/lib/contracts";
import { api, ApiError } from "./api";
import Breadcrumb from "./Breadcrumb";
import DetailPanel from "./DetailPanel";
import MapCanvas from "./MapCanvas";
import { parentOf } from "./paths";
import { markStart, measureAfterPaint } from "./perf";
import type { Pulse } from "./pulses";
import TopBar from "./TopBar";
import { useIndexStatus } from "./useIndexStatus";

/** Levels fetched for one repo and index version (ADR-036): going back up a level is instant until the index moves. */
type LevelCache = { repo: string; version: number; levels: ReadonlyMap<string, LevelResponse> };

const NO_PULSES: ReadonlyMap<string, Pulse> = new Map();

/** The Map (PIVOT_SPEC.md §7): the page's one client component. */
export default function MapView(){
    return (
        <ReactFlowProvider>
            <MapScreen />
        </ReactFlowProvider>
    );
}

function MapScreen(){
    const { status, error: statusError } = useIndexStatus();
    const [levelPath, setLevelPath] = useState("");
    const [cache, setCache] = useState<LevelCache | null>(null);
    const [levelError, setLevelError] = useState<ApiError | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const repo = status?.repo ?? null;
    const version = status?.indexVersion ?? null;
    // the level on screen: the one asked for, from this repo. While a newer version loads, the older copy stays up.
    const level = cache !== null && cache.repo === repo ? cache.levels.get(levelPath) ?? null : null;
    const current = cache !== null && cache.repo === repo && cache.version === version && cache.levels.has(levelPath);

    useEffect(() => {
        if (repo === null || version === null || current) return;
        const controller = new AbortController();
        api.level(levelPath, controller.signal).then(
            (next) => {
                setCache((c) => ({
                    repo: next.repo,
                    version: next.indexVersion,
                    levels: new Map(c !== null && c.repo === next.repo && c.version === next.indexVersion ? c.levels : []).set(levelPath, next),
                }));
                setLevelError(null);
            },
            (err: unknown) => { if (err instanceof ApiError) setLevelError(err); },
        );
        return () => controller.abort();
    }, [repo, version, levelPath, current]);

    /**
     * Opens a folder's level, the Map's main move. The timing mark goes down only when the level changes: the canvas
     * reports a draw only then, and a mark nobody measures would be read at the next level change as one long one.
     */
    const open = useCallback((folder: string) => {
        if (folder !== levelPath) markStart("map:level");
        setLevelPath(folder);
        setSelected(null);
    }, [levelPath]);

    const select = useCallback((target: string | null) => {
        if (target !== null) markStart("map:select");
        setSelected(target);
    }, []);

    /** Goes to the level that holds a path and selects it there: search results, the panel's links, focus_node. */
    const focus = useCallback((target: string) => {
        if (target === ""){
            open("");
            return;
        }
        const next = parentOf(target);
        // a new level is timed as one; a box on the level already showing is a selection (open() says why)
        markStart(next !== levelPath ? "map:level" : "map:select");
        setLevelPath(next);
        setSelected(target);
    }, [open, levelPath]);

    const onDrawn = useCallback(() => measureAfterPaint("map:level"), []);

    // Escape lets go of the selection, Backspace goes up a level, unless the user is typing
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName);
            if (typing) return;
            if (event.key === "Escape") setSelected(null);
            else if (event.key === "Backspace" && levelPath !== "") open(parentOf(levelPath));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [levelPath, open]);

    if (statusError?.code === "INDEX_EMPTY") return <EmptyState />;

    return (
        <div className="absolute inset-0 flex flex-col">
            <TopBar repo={<span className="truncate font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-300">{repo ? repo.slice(repo.lastIndexOf("/") + 1) : "…"}</span>} />
            <div className="pointer-events-auto relative z-10 flex h-9 items-center justify-between gap-4 border-b border-purple-500/10 bg-[#06070B]/40 px-4 backdrop-blur-md">
                {level && repo ? <Breadcrumb repo={repo} trail={level.breadcrumb} onOpen={open} /> : <span />}
                {level && level.hiddenCount > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {level.nodes.length - 1} of {level.nodes.length - 1 + level.hiddenCount} shown
                    </span>
                )}
            </div>
            <main className="relative flex-1">
                {level && (
                    <MapCanvas level={level} selected={selected} highlighted={new Set()} pulses={NO_PULSES} onSelect={select} onOpen={open} onDrawn={onDrawn} />
                )}
                {!level && !levelError && <p className="absolute inset-0 grid place-items-center font-mono text-xs text-zinc-500">Loading the map…</p>}
                {levelError && <p className="absolute inset-x-0 top-6 text-center font-mono text-xs text-red-300">{levelError.message}</p>}
                {selected !== null && level && (
                    <DetailPanel
                        key={selected}
                        path={selected}
                        level={level}
                        indexVersion={version ?? 0}
                        onFocus={focus}
                        onOpen={open}
                        onClose={() => setSelected(null)}
                    />
                )}
            </main>
        </div>
    );
}

function EmptyState(){
    return (
        <div className="absolute inset-0 grid place-items-center">
            <div className="max-w-md space-y-2 text-center font-mono text-xs text-zinc-400">
                <p className="text-zinc-200">No repository indexed yet.</p>
                <p>Index one from a terminal, then reload: <code className="text-purple-200">npm run index -- &lt;path-to-repo&gt;</code></p>
            </div>
        </div>
    );
}
