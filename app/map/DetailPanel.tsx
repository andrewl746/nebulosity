"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AreaCount, DescribeResponse, LevelResponse, MapNode, SummarizeResponse, SymbolInfo } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { formatCount } from "./format";
import { nameOf } from "./paths";
import { measureAfterPaint } from "./perf";
import { placeholderFor, wantsSummary } from "./summaries";

type DetailPanelProps = {
    /** The selection: a file, a folder, the repo, or the level's "+N more" box. */
    path: string;
    level: LevelResponse;
    /** Moves when the index changes; the panel then refetches. */
    indexVersion: number;
    /** Go to the level holding a path and select it there. */
    onFocus: (targetPath: string) => void;
    onOpen: (folder: string) => void;
    onClose: () => void;
};

/** Long lists show this many at a time (PIVOT_SPEC.md §7: "20 entries plus load more"). */
const PAGE = 20;

/**
 * The detail panel (PIVOT_SPEC.md §7). It opens on selection with what describe() knows: the summary, the size, what's
 * inside (children or symbols), what it uses and what uses it. A missing or out-of-date summary is asked for once
 * ("summarize now", §5.3). Selecting "+N more" lists the boxes it folds. MapView remounts the panel for each
 * selection (key), so nothing leaks from one target to the next.
 */
export default function DetailPanel({ path, level, indexVersion, onFocus, onOpen, onClose }: DetailPanelProps){
    const more = level.nodes.find((n) => n.path === path && n.kind === "more") ?? null;
    const isMore = more !== null;
    const target = isMore ? level.path : path;
    const [data, setData] = useState<DescribeResponse | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [fresh, setFresh] = useState<SummarizeResponse | null>(null);
    const [summaryError, setSummaryError] = useState<ApiError | null>(null);
    // keys already asked for: "<path>@<index version>", or the bare path once the server answered NOT_READY
    const asked = useRef(new Set<string>());

    useEffect(() => {
        const controller = new AbortController();
        api.describe(target, controller.signal).then(
            (next) => { setData(next); setError(null); },
            (err: unknown) => { if (err instanceof ApiError) setError(err); },
        );
        return () => controller.abort();
    }, [target, indexVersion]);

    useEffect(() => {
        if (data) measureAfterPaint("map:select");
    }, [data]);

    // "summarize now", once per target and index version: the server joins a request already running (ADR-033).
    // After a NOT_READY answer, once per target: the index moves with every child summary the worker writes, and each
    // move would otherwise ask again for a folder that still isn't ready. Reselecting it asks afresh (a new panel).
    useEffect(() => {
        if (data === null || isMore || !wantsSummary(data.summaryStatus)) return;
        const key = `${data.path}@${data.indexVersion}`;
        if (asked.current.has(data.path) || asked.current.has(key)) return;
        asked.current.add(key);
        api.summarize(data.path).then(setFresh, (err: unknown) => {
            if (!(err instanceof ApiError)) return;
            if (err.code === "NOT_READY") asked.current.add(data.path);
            setSummaryError(err);
        });
    }, [data, isMore]);

    const retry = (): void => {
        if (data === null) return;
        setSummaryError(null);
        api.summarize(data.path).then(setFresh, (err: unknown) => { if (err instanceof ApiError) setSummaryError(err); });
    };

    const name = more ? more.name : nameOf(target, level.repo);
    const kindLabel = more ? "folded here" : data?.kind ?? "";

    return (
        <aside data-panel={path} className="pointer-events-auto absolute inset-y-0 right-0 z-10 flex w-[380px] flex-col border-l border-purple-400/20 bg-[#0c0716]/85 font-mono backdrop-blur-xl">
            <header className="flex items-start justify-between gap-2 border-b border-purple-400/15 px-4 py-3">
                <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">{kindLabel}</div>
                    <h2 className="truncate text-[13px] text-zinc-100">{name}</h2>
                    <div className="truncate text-[10px] text-zinc-500">{target || "(repo root)"}</div>
                </div>
                <button type="button" onClick={onClose} aria-label="Close the panel" className="text-lg leading-none text-zinc-500 hover:text-zinc-200">×</button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-[11.5px] leading-relaxed text-zinc-300">
                {error && <p className="text-red-300">{error.message}</p>}
                {!data && !error && <p className="text-zinc-500">Loading…</p>}
                {data && more && <FoldedList data={data} level={level} onFocus={onFocus} />}
                {data && !more && (
                    <Details data={data} fresh={fresh} summaryError={summaryError} onRetry={retry} onFocus={onFocus} onOpen={onOpen} />
                )}
            </div>
        </aside>
    );
}

type DetailsProps = {
    data: DescribeResponse;
    fresh: SummarizeResponse | null;
    summaryError: ApiError | null;
    onRetry: () => void;
    onFocus: (targetPath: string) => void;
    onOpen: (folder: string) => void;
};

function Details({ data, fresh, summaryError, onRetry, onFocus, onOpen }: DetailsProps){
    // a "summarize now" answer is newer than the description it was asked from
    const shown = fresh ?? data;
    const editorLink = (line?: number) => `vscode://file/${data.repo}/${data.path}${line ? `:${line}` : ""}`;

    return (
        <>
            <section>
                {shown.tagline
                    ? <p className={`text-[12.5px] ${shown.summaryStatus === "stale" ? "text-zinc-400" : "text-zinc-100"}`}>{shown.tagline}</p>
                    : <p className="italic text-zinc-500">{summaryError?.code === "NOT_READY" ? "Waiting for what's inside to be summarized first." : placeholderFor(shown.summaryStatus)}</p>}
                {shown.summary && <p className="mt-1.5 text-zinc-300">{shown.summary}</p>}
                {/* the summary was written from an "Imported by" line that counts tests apart; "Used by" below counts them */}
                {shown.summary && data.kind === "file" && (
                    <p className="mt-1 text-[10px] text-zinc-600">Import counts in this summary leave out test files.</p>
                )}
                {shown.summaryStatus === "stale" && <p className="mt-1.5 text-[10.5px] text-amber-200/70">Out of date: this changed since it was summarized.</p>}
                {(shown.summaryError ?? (summaryError && summaryError.code !== "NOT_READY" ? summaryError.message : null)) && (
                    <p className="mt-1.5 text-[10.5px] text-red-300">
                        {shown.summaryError ?? summaryError?.message}{" "}
                        <button type="button" onClick={onRetry} className="underline hover:text-red-200">Try again</button>
                    </p>
                )}
            </section>

            <section className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-zinc-500">
                <span>{formatCount(data.stats.fileCount)} {data.stats.fileCount === 1 ? "file" : "files"} · {formatCount(data.stats.lineCount)} lines</span>
                {data.stalePaths > 0 && <span className="text-amber-200/70">{formatCount(data.stalePaths)} changed since summarized</span>}
                {data.kind === "folder" && <button type="button" onClick={() => onOpen(data.path)} className="text-purple-300/80 hover:text-purple-200">Open folder</button>}
                {data.kind === "file" && <a href={editorLink()} className="text-purple-300/80 hover:text-purple-200">Open in VS Code</a>}
            </section>

            {data.children && (
                <List title="Inside" items={data.children} render={(child: MapNode) => (
                    <li key={child.path}>
                        <button type="button" onClick={() => onFocus(child.path)} className="w-full text-left hover:text-purple-200">
                            <span className="text-zinc-200">{child.name}{child.kind === "folder" ? "/" : ""}</span>
                            <span className="text-zinc-600"> · {child.kind === "folder" ? `${formatCount(child.fileCount)} files` : "file"}</span>
                            {child.tagline && <span className="block truncate text-[10.5px] text-zinc-500">{child.tagline}</span>}
                        </button>
                    </li>
                )} />
            )}

            {data.symbols && (
                <List title="Declarations" items={data.symbols} empty="None found." render={(symbol: SymbolInfo) => (
                    <li key={`${symbol.name}:${symbol.startLine}`}>
                        <a href={editorLink(symbol.startLine)} className="hover:text-purple-200">
                            <span className={symbol.exported ? "text-zinc-200" : "text-zinc-400"}>{symbol.name}</span>
                            <span className="text-zinc-600"> · {symbol.kind} · line {symbol.startLine}</span>
                        </a>
                    </li>
                )} />
            )}

            <List title="Uses" items={data.uses} empty="Imports nothing outside itself." render={(area: AreaCount) => <AreaRow key={area.path} area={area} onFocus={onFocus} />} />
            <List
                title="Used by"
                note="imports from outside it, by area, test files included"
                items={data.usedBy}
                empty="Nothing outside it imports it."
                render={(area: AreaCount) => <AreaRow key={area.path} area={area} onFocus={onFocus} />}
            />
        </>
    );
}

function AreaRow({ area, onFocus }: { area: AreaCount; onFocus: (targetPath: string) => void }){
    return (
        <li>
            <button type="button" onClick={() => onFocus(area.path)} className="flex w-full justify-between gap-3 text-left hover:text-purple-200">
                <span className="truncate">{area.path}{area.kind === "folder" ? "/" : ""}</span>
                <span className="shrink-0 text-zinc-500">{formatCount(area.count)}</span>
            </button>
        </li>
    );
}

/** "+N more" selected: the boxes it folds, from describe(level).children minus the ones drawn. */
function FoldedList({ data, level, onFocus }: { data: DescribeResponse; level: LevelResponse; onFocus: (targetPath: string) => void }){
    const drawn = new Set(level.nodes.map((n) => n.path));
    const folded = (data.children ?? []).filter((child) => !drawn.has(child.path));
    return (
        <List title="Folded into this box" items={folded} render={(child: MapNode) => (
            <li key={child.path}>
                <button type="button" onClick={() => onFocus(child.path)} className="w-full text-left hover:text-purple-200">
                    <span className="text-zinc-200">{child.name}{child.kind === "folder" ? "/" : ""}</span>
                    {child.tagline && <span className="block truncate text-[10.5px] text-zinc-500">{child.tagline}</span>}
                </button>
            </li>
        )} />
    );
}

type ListProps<T> = {
    title: string;
    /** What the counts in the list mean, under the title. */
    note?: string;
    items: readonly T[];
    render: (item: T) => ReactNode;
    empty?: string;
};

/** A titled list that shows PAGE items at a time. */
function List<T>({ title, note, items, render, empty }: ListProps<T>){
    const [shown, setShown] = useState(PAGE);
    if (items.length === 0 && empty === undefined) return null;

    return (
        <section>
            <h3 className={`${note ? "" : "mb-1.5 "}text-[10px] uppercase tracking-[0.25em] text-zinc-500`}>
                {title} <span className="text-zinc-600">{formatCount(items.length)}</span>
            </h3>
            {note && <p className="mb-1.5 text-[10px] text-zinc-600">{note}</p>}
            {items.length === 0
                ? <p className="text-zinc-600">{empty}</p>
                : <ul className="space-y-1">{items.slice(0, shown).map(render)}</ul>}
            {items.length > shown && (
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-1.5 text-[10.5px] text-purple-300/80 hover:text-purple-200">
                    Show {Math.min(PAGE, items.length - shown)} more of {formatCount(items.length - shown)}
                </button>
            )}
        </section>
    );
}
