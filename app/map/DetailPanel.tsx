"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowLeft, IconArrowRight, IconCode, IconFile, IconFolder, IconX } from "@tabler/icons-react";
import type { AreaCount, DescribeResponse, LevelResponse, MapNode, SummarizeResponse, SymbolInfo } from "@/lib/contracts";
import { api, ApiError, demoGithub, type GitHubSource } from "./api";
import { formatCompact, formatCount } from "./format";
import { noDeclarationsText } from "./labels";
import { editorLink, githubLink } from "./links";
import { DEMO } from "./mode";
import { nameOf, shortPath } from "./paths";
import { measureAfterPaint } from "./perf";
import { linkedFrom, portalCaption, portalLinks } from "./portals";
import { failureFor, summaryLine, wantsSummary } from "./summaries";
import SourceViewer from "./SourceViewer";
import { inlineCode, splitSummary } from "./text";

type DetailPanelProps = {
    /** The selection: a file, a folder, the repo, or one of the level's portals. */
    path: string;
    level: LevelResponse;
    /** Moves when the index changes; the panel then refetches. */
    indexVersion: number;
    /** Go to the level holding a path and select it there. */
    onFocus: (targetPath: string) => void;
    onOpen: (folder: string) => void;
    /** Turn to another page of the level on screen. */
    onTurnPage: (page: number) => void;
    onClose: () => void;
    /**
     * Inside VS Code's panel only: a declaration opens at its line in the editor instead of the source viewer, which
     * "View source" still opens (design §4.4).
     */
    onOpenInEditor?: (path: string, line?: number) => void;
};

/** The panel's width: the canvas's controls move left by this much while it's open, so it never covers them. */
export const PANEL_WIDTH = 400;

/** Chips and rows shown before "+N more" or "View all": enough to act on without scrolling. */
const PREVIEW = 8;

const KIND_LABELS: Record<DescribeResponse["kind"], string> = { repo: "Repository", folder: "Folder", file: "File" };

/**
 * The details panel (VISUAL_REFRESH.md §5), top to bottom: what kind of thing it is, its name, its size, a short
 * summary that expands, what it depends on and what uses it (chips that focus the Map), and what's inside. A missing
 * or out-of-date summary is asked for once ("summarize now", PIVOT_SPEC.md §5.3), and the panel says so while it's
 * refreshing. A portal gets its own panel (PortalPanel). MapView remounts the panel for each selection (key), so
 * nothing leaks from one target to the next.
 */
function DetailPanel(props: DetailPanelProps){
    const portal = props.level.nodes.find((n) => n.path === props.path && n.kind === "portal");
    return portal ? <PortalPanel portal={portal} {...props} /> : <TargetPanel {...props} />;
}

// memo: the Map's clock ticks each second while Claude Code is active, and an expanded list can hold 1,000 rows
export default memo(DetailPanel);

type PanelFrameProps = {
    path: string;
    kindLabel: string;
    name: string;
    title: string;
    subtitle: string;
    /** Under the name: the stats line and its actions. */
    header?: ReactNode;
    onClose: () => void;
    children: ReactNode;
};

/** The panel's frame: the kind, the name, the path under it, a close button, then the header's extras and the body. */
function PanelFrame({ path, kindLabel, name, title, subtitle, header, onClose, children }: PanelFrameProps){
    return (
        <aside data-panel={path} style={{ width: PANEL_WIDTH }} className="pointer-events-auto absolute inset-y-0 right-0 z-10 flex flex-col border-l border-hairline bg-panel">
            <header className="border-b border-hairline px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[12px] leading-4 text-text-2">{kindLabel}</div>
                        <h2 className="mt-1 truncate text-[18px] font-medium leading-6 text-text" title={title}>{name}</h2>
                        <div className="truncate font-mono text-[12px] leading-4 text-text-2" title={subtitle}>{subtitle}</div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close the panel" className="shrink-0 rounded-md p-1 text-text-2 hover:bg-surface hover:text-text">
                        <IconX aria-hidden size={16} stroke={1.75} />
                    </button>
                </div>
                {header}
            </header>
            {children}
        </aside>
    );
}

/** A file, a folder or the repo: described by the server (GET /api/describe). */
function TargetPanel({ path, level, indexVersion, onFocus, onOpen, onClose, onOpenInEditor }: DetailPanelProps){
    const target = path;
    const [data, setData] = useState<DescribeResponse | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [fresh, setFresh] = useState<SummarizeResponse | null>(null);
    const [summaryError, setSummaryError] = useState<ApiError | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    // keys already asked for: "<path>@<index version>", or the bare path once the server answered NOT_READY
    const asked = useRef(new Set<string>());
    // the demo's source links go to GitHub at the commit the index was built from (ADR-049)
    const [github, setGithub] = useState<GitHubSource | null>(null);

    useEffect(() => {
        if (DEMO) demoGithub().then(setGithub, () => {});
    }, []);

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

    /** "Summarize now": the answer replaces what describe() said, and "Refreshing…" shows until it lands. */
    const summarize = (targetPath: string, onNotReady?: () => void): void => {
        setRefreshing(true);
        api.summarize(targetPath).then(
            (answer) => { setFresh(answer); setRefreshing(false); },
            (err: unknown) => {
                setRefreshing(false);
                if (!(err instanceof ApiError)) return;
                if (err.code === "NOT_READY") onNotReady?.();
                setSummaryError(err);
            },
        );
    };

    // "summarize now", once per target and index version: the server joins a request already running (ADR-033).
    // After a NOT_READY answer, once per target: the index moves with every child summary the worker writes, and each
    // move would otherwise ask again for a folder that still isn't ready. Reselecting it asks afresh (a new panel).
    // The static demo has no server to ask, so it never does (ADR-049).
    useEffect(() => {
        if (DEMO || data === null || !wantsSummary(data.summaryStatus)) return;
        const key = `${data.path}@${data.indexVersion}`;
        if (asked.current.has(data.path) || asked.current.has(key)) return;
        asked.current.add(key);
        summarize(data.path, () => asked.current.add(data.path));
    }, [data]);

    const retry = (): void => {
        if (data === null) return;
        setSummaryError(null);
        summarize(data.path);
    };

    const name = nameOf(target, level.repo);
    const kindLabel = data ? KIND_LABELS[data.kind] : "";
    // the source viewer (owner review): closed, open on the whole file, or open on a declaration's lines
    const [viewing, setViewing] = useState<{ lines?: { start: number; end: number } } | null>(null);
    const closeViewer = useCallback(() => setViewing(null), []);

    return (
        <PanelFrame
            path={path}
            kindLabel={kindLabel}
            name={name}
            title={target || name}
            subtitle={target || "(repo root)"}
            header={data && <Stats data={data} github={github} onOpen={onOpen} onViewSource={() => setViewing({})} />}
            onClose={onClose}
        >
            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 text-[14px] leading-normal text-text">
                {error && <p className="text-danger">{error.message}</p>}
                {!data && !error && <p className="text-text-2">Loading…</p>}
                {data && (
                    <Details
                        data={data}
                        fresh={fresh}
                        refreshing={refreshing}
                        summaryError={summaryError}
                        onRetry={retry}
                        onFocus={onFocus}
                        onOpen={onOpen}
                        onViewLines={DEMO
                            ? (start, end) => { if (github) window.open(githubLink(github, data.path, { start, end }), "_blank", "noreferrer"); }
                            : onOpenInEditor
                                // the real editor is right there (design §4.4)
                                ? (start) => onOpenInEditor(data.path, start)
                                : (start, end) => setViewing({ lines: { start, end } })}
                    />
                )}
            </div>
            {viewing && data?.kind === "file" && <SourceViewer path={data.path} lines={viewing.lines} onClose={closeViewer} />}
        </PanelFrame>
    );
}

type Linked = { path: string; count: number };

/**
 * A portal selected: the page (or pages) behind it, a way to go there, and which boxes on this page have lines to it,
 * each a link that selects that box. Everything comes from the level on screen; there's nothing to fetch.
 */
function PortalPanel({ portal, path, level, onFocus, onTurnPage, onClose }: DetailPanelProps & { portal: MapNode }){
    const links = portalLinks(level.edges, portal.path);
    const linked = linkedFrom(level, portal.path);
    const pages = portal.page !== undefined ? [portal.page] : portal.pages ?? [];
    const byPath = new Map(level.nodes.map((n) => [n.path, n]));

    useEffect(() => {
        measureAfterPaint("map:select");
    }, []);

    return (
        <PanelFrame
            path={path}
            kindLabel={pages.length === 1 ? "Page" : "Pages"}
            name={portal.name}
            title={portal.name}
            subtitle={`${level.path || "(repo root)"} · page ${level.page + 1} of ${level.pageCount}`}
            header={<p className="mt-3 text-[13px] text-text-2">{portalCaption(portal, links)} with this page</p>}
            onClose={onClose}
        >
            <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 text-[14px] leading-normal text-text">
                <section aria-label="Go to">
                    {pages.length > 1 && <SectionTitle title="Pages behind this doorway" count={pages.length} />}
                    <ul className="flex flex-wrap gap-2">
                        {pages.map((p) => (
                            <li key={p}>
                                <button
                                    type="button"
                                    data-go-page={p}
                                    onClick={() => onTurnPage(p)}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-control/60 px-3 py-1.5 text-[13px] text-control hover:border-control"
                                >
                                    {p < level.page && <IconArrowLeft aria-hidden size={14} stroke={1.75} />}
                                    {pages.length === 1 ? `Go to page ${p + 1}` : `Page ${p + 1}`}
                                    {p > level.page && <IconArrowRight aria-hidden size={14} stroke={1.75} />}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                <Rows title="Linked from this page" items={linked} empty="No lines from this page." render={({ path: boxPath, count }: Linked) => (
                    <li key={boxPath}>
                        <button
                            type="button"
                            data-linked={boxPath}
                            title={`${boxPath}: ${formatCount(count)} import${count === 1 ? "" : "s"} with ${portal.name}`}
                            onClick={() => onFocus(boxPath)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface"
                        >
                            <BoxIcon box={byPath.get(boxPath)} />
                            <span className="min-w-0 flex-1 truncate">{byPath.get(boxPath)?.name ?? boxPath}</span>
                            <span className="shrink-0 text-[12px] text-text-2">{formatCount(count)}</span>
                        </button>
                    </li>
                )} />
            </div>
        </PanelFrame>
    );
}

/** A folder's or a file's icon, as on the Map. */
function BoxIcon({ box }: { box: MapNode | undefined }){
    const folder = box?.kind === "folder";
    const Icon = folder ? IconFolder : IconFile;
    return <Icon aria-hidden size={16} stroke={1.75} className={`shrink-0 ${folder ? "text-folder" : "text-text-2"}`} />;
}

type StatsProps = { data: DescribeResponse; github: GitHubSource | null; onOpen: (folder: string) => void; onViewSource: () => void };

/**
 * "10,276 files · 3.4M lines", what changed since it was summarized, and the one action that fits the target. For a
 * file, the app offers its source and the editor; the demo has neither, so it links to GitHub at the indexed commit.
 */
function Stats({ data, github, onOpen, onViewSource }: StatsProps){
    const lines = `${formatCompact(data.stats.lineCount)} ${data.stats.lineCount === 1 ? "line" : "lines"}`;
    const size = data.kind === "file" ? lines : `${formatCount(data.stats.fileCount)} ${data.stats.fileCount === 1 ? "file" : "files"} · ${lines}`;
    return (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2">
            <span>{size}</span>
            {data.stalePaths > 0 && <span>{formatCount(data.stalePaths)} changed since summarized</span>}
            {data.kind === "folder" && (
                <button type="button" onClick={() => onOpen(data.path)} className="text-control underline underline-offset-2 hover:text-text">Open folder</button>
            )}
            {data.kind === "file" && DEMO && github && (
                <a href={githubLink(github, data.path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-control underline underline-offset-2 hover:text-text">
                    <IconCode aria-hidden size={14} stroke={1.75} />View on GitHub
                </a>
            )}
            {data.kind === "file" && !DEMO && (
                <>
                    <button type="button" onClick={onViewSource} className="inline-flex items-center gap-1 text-control underline underline-offset-2 hover:text-text">
                        <IconCode aria-hidden size={14} stroke={1.75} />View source
                    </button>
                    <a href={editorLink(data)} className="text-control underline underline-offset-2 hover:text-text">Open in VS Code</a>
                </>
            )}
        </div>
    );
}

type DetailsProps = {
    data: DescribeResponse;
    fresh: SummarizeResponse | null;
    refreshing: boolean;
    summaryError: ApiError | null;
    onRetry: () => void;
    onFocus: (targetPath: string) => void;
    onOpen: (folder: string) => void;
    /** Opens the source viewer on a declaration's lines. */
    onViewLines: (start: number, end: number) => void;
};

function Details({ data, fresh, refreshing, summaryError, onRetry, onFocus, onOpen, onViewLines }: DetailsProps){
    return (
        <>
            <Summary data={data} fresh={fresh} refreshing={refreshing} summaryError={summaryError} onRetry={onRetry} />

            <section aria-label="Relationships" className="space-y-4">
                {/* the three-task test's tester took a while to find these and to match them to the arrows: say it */}
                <Chips title="Depends on" note="What this box uses: its arrows point to these · by number of imports" items={data.uses} empty="Imports nothing outside itself." onFocus={onFocus} />
                <Chips title="Used by" note="What uses this box: their arrows point here · by number of imports, test files included" items={data.usedBy} empty="Nothing outside it imports it." onFocus={onFocus} />
            </section>

            {data.children && (
                <Rows title="Contents" items={data.children} render={(child: MapNode) => (
                    <ChildRow key={child.path} child={child} onFocus={onFocus} onOpen={onOpen} />
                )} />
            )}

            {data.symbols && (
                <Rows title="Declarations" items={data.symbols} empty={noDeclarationsText(data)} render={(symbol: SymbolInfo) => (
                    <li key={`${symbol.name}:${symbol.startLine}`}>
                        <button
                            type="button"
                            title={`Show ${symbol.name} in the source`}
                            onClick={() => onViewLines(symbol.startLine, symbol.endLine)}
                            className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-surface"
                        >
                            <span className={`truncate font-mono text-[13px] ${symbol.exported ? "text-text" : "text-text-2"}`}>{symbol.name}</span>
                            <span className="shrink-0 text-[12px] text-text-2">{symbol.kind} · line {symbol.startLine}</span>
                        </button>
                    </li>
                )} />
            )}
        </>
    );
}

type SummaryProps = Pick<DetailsProps, "data" | "fresh" | "refreshing" | "summaryError" | "onRetry">;

/** The tagline and the first sentence; "Read full summary" shows the rest and "Show less" folds it back. */
function Summary({ data, fresh, refreshing, summaryError, onRetry }: SummaryProps){
    const [expanded, setExpanded] = useState(false);
    // a "summarize now" answer is newer than the description it was asked from
    const shown = fresh ?? data;
    const { lead, rest } = splitSummary(shown.summary ?? "");
    const failure = failureFor(shown.summaryError, summaryError);

    return (
        <section aria-label="Summary">
            {shown.tagline
                ? <p className="text-[15px] font-medium leading-snug text-title"><Rich text={shown.tagline} /></p>
                : <p className="text-text-2">{summaryLine(shown.summaryStatus, summaryError)}</p>}
            {lead && <p className="mt-2 text-text-body"><Rich text={lead} /></p>}
            {rest && expanded && rest.split(/\n\s*\n/).map((paragraph, i) => <p key={i} className="mt-2 text-text-body"><Rich text={paragraph} /></p>)}
            {/* it folds back, so a long summary doesn't push the rest of the panel away for good (owner review) */}
            {rest && (
                <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((open) => !open)}
                    className="mt-2 text-[13px] text-control underline underline-offset-2 hover:text-text"
                >
                    {expanded ? "Show less" : "Read full summary"}
                </button>
            )}
            <div className="mt-2 space-y-1 text-[13px] text-text-2">
                {refreshing && shown.tagline && <p>Refreshing…</p>}
                {shown.summaryStatus === "stale" && !refreshing && <p>Out of date: this changed since it was summarized.</p>}
                {/* the summary was written from an "Imported by" line that counts tests apart; "Used by" below counts them */}
                {shown.summary && data.kind === "file" && <p className="text-[12px]">Import counts in this summary leave out test files.</p>}
                {failure && (
                    <p className="text-danger">
                        {failure}{" "}
                        <button type="button" onClick={onRetry} className="text-control underline underline-offset-2 hover:text-text">Try again</button>
                    </p>
                )}
            </div>
        </section>
    );
}

/**
 * Prose with its `identifiers` as inline code (VISUAL_REFRESH.md §5): the code font and lavender on a chip. The chips
 * were dropped once for an outside critique ("noisy"), and the owner asked for them back: they make names easy to spot.
 */
function Rich({ text }: { text: string }){
    return (
        <>
            {inlineCode(text).map((part, i) => part.code
                ? <code key={i} className="rounded-md bg-code-bg px-1 font-mono text-[13px] text-code">{part.text}</code>
                : <span key={i}>{part.text}</span>)}
        </>
    );
}

function SectionTitle({ title, count, note, large = false }: { title: string; count: number; note?: string; large?: boolean }){
    return (
        <div className="mb-2">
            <h3 className={`${large ? "text-[15px]" : "text-[13px]"} font-medium text-text`}>
                {title} <span className="font-normal text-text-2">{formatCount(count)}</span>
            </h3>
            {note && <p className="text-[12px] text-text-2">{note}</p>}
        </div>
    );
}

type ChipsProps = { title: string; note: string; items: readonly AreaCount[]; empty: string; onFocus: (targetPath: string) => void };

/** "Depends on" / "Used by" as chips (§5): each focuses that area on the Map. The first 8, "+N more", then "Show fewer". */
function Chips({ title, note, items, empty, onFocus }: ChipsProps){
    const [all, setAll] = useState(false);
    const shown = all ? items : items.slice(0, PREVIEW);
    return (
        <div>
            <SectionTitle title={title} count={items.length} note={note} large />
            {items.length === 0
                ? <p className="text-[13px] text-text-2">{empty}</p>
                : (
                    <ul className="flex flex-wrap gap-2">
                        {shown.map((area) => (
                            <li key={area.path} className="min-w-0">
                                <button
                                    type="button"
                                    data-chip={area.path}
                                    title={`${area.path}: ${formatCount(area.count)} import${area.count === 1 ? "" : "s"}`}
                                    onClick={() => onFocus(area.path)}
                                    className="flex max-w-[360px] items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-text hover:border-text-2"
                                >
                                    <span className="truncate">{shortPath(area.path)}</span>
                                    <span className="shrink-0 text-text-2">{formatCount(area.count)}</span>
                                </button>
                            </li>
                        ))}
                        {items.length > PREVIEW && (
                            <li>
                                <button
                                    type="button"
                                    aria-expanded={all}
                                    onClick={() => setAll((open) => !open)}
                                    className="rounded-md border border-dashed border-border px-2 py-1 text-[13px] text-text-2 hover:text-text"
                                >
                                    {all ? "Show fewer" : `+${formatCount(items.length - PREVIEW)} more`}
                                </button>
                            </li>
                        )}
                    </ul>
                )}
        </div>
    );
}

/** A child in Contents: a folder goes into it, a file is selected on the Map (§5). */
function ChildRow({ child, onFocus, onOpen }: { child: MapNode; onFocus: (targetPath: string) => void; onOpen: (folder: string) => void }){
    const folder = child.kind === "folder";
    const Icon = folder ? IconFolder : IconFile;
    return (
        <li>
            <button
                type="button"
                data-child={child.path}
                title={child.tagline ? `${child.path}: ${child.tagline}` : child.path}
                onClick={() => (folder ? onOpen(child.path) : onFocus(child.path))}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface"
            >
                <Icon aria-hidden size={16} stroke={1.75} className={`shrink-0 ${folder ? "text-folder" : "text-text-2"}`} />
                <span className="min-w-0 flex-1 truncate">{child.name}</span>
                {folder && <span className="shrink-0 text-[12px] text-text-2">{formatCount(child.fileCount)} {child.fileCount === 1 ? "file" : "files"}</span>}
            </button>
        </li>
    );
}

type RowsProps<T> = {
    title: string;
    items: readonly T[];
    render: (item: T) => ReactNode;
    empty?: string;
};

/** A titled list: the first 8, then "View all" shows the rest and "Show fewer" folds it back. */
function Rows<T>({ title, items, render, empty }: RowsProps<T>){
    const [all, setAll] = useState(false);
    if (items.length === 0 && empty === undefined) return null;

    return (
        <section aria-label={title}>
            <SectionTitle title={title} count={items.length} />
            {items.length === 0
                ? <p className="text-[13px] text-text-2">{empty}</p>
                : <ul className="-mx-2">{(all ? items : items.slice(0, PREVIEW)).map(render)}</ul>}
            {items.length > PREVIEW && (
                <button
                    type="button"
                    aria-expanded={all}
                    onClick={() => setAll((open) => !open)}
                    className="mt-2 text-[13px] text-control underline underline-offset-2 hover:text-text"
                >
                    {all ? "Show fewer" : `View all ${formatCount(items.length)}`}
                </button>
            )}
        </section>
    );
}
