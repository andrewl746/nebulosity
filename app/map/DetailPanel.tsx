"use client";

import { memo, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconArrowLeft, IconArrowRight, IconFile, IconFolder, IconX } from "@tabler/icons-react";
import type { AreaCount, DescribeResponse, LevelResponse, MapNode, SummarizeResponse, SymbolInfo } from "@/lib/contracts";
import { api, ApiError, demoGithub, type GitHubSource } from "./api";
import { formatCount } from "./format";
import {
    barWidth,
    childTitle,
    declarationPlace,
    defaultTab,
    githubFolderLink,
    importsTitle,
    inspectorName,
    inspectorTitle,
    kindBeforeDescribe,
    largestCount,
    sizeLine,
    type InspectorTab,
} from "./inspector";
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
    /** The selection: a file, a folder, the repo, or one of the level's portals. Or, with onScreenFolder, the folder on screen. */
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
    /** Where MapView put it (app/map/shell.ts's InspectorPlace, without "none"): beside the canvas, under it, over it as a drawer, or over all of it. */
    placement: "beside" | "below" | "drawer" | "cover";
    /** Nothing is selected and the panel describes the folder on screen: then it has no close button. */
    onScreenFolder?: boolean;
    /** The Map's error line, shown as the panel's last row while the panel covers the canvas it would sit on. */
    alert?: string;
};

/** Rows shown before "+N more": enough to act on without scrolling. */
const PREVIEW = 8;

/** The one primary button, Open folder (the mockup's .primary): the accent is for meaning, and this is the way in. */
const PRIMARY = "inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-[5px] bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-110";
/** Every other action, and the doorway's go-to-page buttons (the mockup's .secondary). */
const SECONDARY = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border px-3 text-[13px] text-text hover:border-text-3";
/** A control inside prose: Full summary, Show less, Try again (the mockup's .more). */
const TEXT_LINK = "text-text underline decoration-text-3 underline-offset-2 hover:decoration-text";
/** "+N more" and "Show fewer" under a list, quieter than the rows they unfold. */
const QUIET = "mt-1 rounded-[5px] px-2 py-1 text-[12.5px] text-text-2 hover:text-text";

/**
 * The body under the name. One column that scrolls on its own, the header staying put. Under the canvas, in a panel at
 * least 720 px wide, two columns side by side that each scroll (the summary and actions, then the tabs), as collapse
 * option C's render at 820 × 900 has it. The queries go by the panel's own width (@container on the frame), not the
 * window's, since the explorer and the canvas share the window with it.
 */
const BODY = "min-h-0 flex-1 overflow-y-auto pb-4";
// one row as tall as the body (grid-rows-1 is minmax(0, 1fr)), so each column scrolls instead of the body
const BODY_TWO = "@min-[720px]:grid @min-[720px]:grid-cols-2 @min-[720px]:grid-rows-1 @min-[720px]:pb-0";
const COLUMN_TWO = "@min-[720px]:min-h-0 @min-[720px]:overflow-y-auto @min-[720px]:pb-4";

/**
 * The inspector (the Workbench redesign, 2026-10-27; mockup3.html's .insp), top to bottom: the name in the code font
 * and its size, the tagline and a summary that expands, the actions that fit the target, then tabs for what it uses,
 * what uses it, and what's inside, each row a name, a count and a bar. A missing or out-of-date summary is asked for
 * once ("summarize now", PIVOT_SPEC.md §5.3), and the panel says so while it's refreshing. A portal gets its own panel
 * (PortalPanel). MapView places it (beside, under or over the canvas) and remounts it for each selection (key), so
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
    placement: DetailPanelProps["placement"];
    onScreenFolder?: boolean;
    alert?: string;
    name: string;
    /** The name's hover title: the whole path, which the name alone doesn't show. It holds the name too. */
    title: string;
    /** Under the name: the sizes, or a doorway's caption. */
    meta?: string;
    onClose: () => void;
    children: ReactNode;
};

/**
 * The panel's frame. It fills whatever MapView put it in. The name and the close button stay put while the body under
 * them scrolls, and the Map's error line is its last row while it covers the canvas (so the row never hides the end of
 * the body). Under the canvas its border is on top, everywhere else on its left.
 */
function PanelFrame({ path, placement, onScreenFolder = false, alert, name, title, meta, onClose, children }: PanelFrameProps){
    return (
        <aside
            data-panel={path}
            data-placement={placement}
            data-on-screen={onScreenFolder || undefined}
            className={`@container pointer-events-auto flex h-full min-h-0 w-full min-w-0 flex-col border-divider bg-panel ${placement === "below" ? "border-t" : "border-l"}`}
        >
            <header className="flex shrink-0 items-start justify-between gap-2 px-4 pb-3 pt-4">
                <div className="min-w-0">
                    <h2 className="truncate font-mono text-[15px] font-medium leading-5 text-text" title={title}>{name}</h2>
                    {meta && <p className="mt-0.5 text-[12.5px] leading-[18px] text-text-2">{meta}</p>}
                </div>
                {/* describing the folder on screen, it's part of the layout rather than something opened, so it stays */}
                {!onScreenFolder && (
                    <button type="button" onClick={onClose} aria-label="Close the panel" className="-mr-1 shrink-0 rounded-[5px] p-1 text-text-2 hover:bg-node hover:text-text">
                        <IconX aria-hidden size={16} stroke={1.75} />
                    </button>
                )}
            </header>
            {children}
            {alert && <p role="alert" data-covers className="pointer-events-none shrink-0 border-t border-divider bg-panel px-4 py-2 text-center text-[13px] text-danger [overflow-wrap:anywhere]">{alert}</p>}
        </aside>
    );
}

/** A file, a folder or the repo: described by the server (GET /api/describe). */
function TargetPanel({ path, level, indexVersion, onFocus, onOpen, onClose, onOpenInEditor, placement, onScreenFolder, alert }: DetailPanelProps){
    const target = path;
    const [data, setData] = useState<DescribeResponse | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [fresh, setFresh] = useState<SummarizeResponse | null>(null);
    const [summaryError, setSummaryError] = useState<ApiError | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    // the tab on screen: picked from the first answer (defaultTab), then kept while this panel is open, refetches too
    const [tab, setTab] = useState<InspectorTab | null>(null);
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
            (next) => { setData(next); setError(null); setTab((current) => current ?? defaultTab(next)); },
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

    const kind = data?.kind ?? kindBeforeDescribe(target, level);
    // the source viewer (owner review): closed, open on the whole file, or open on a declaration's lines
    const [viewing, setViewing] = useState<{ lines?: { start: number; end: number } } | null>(null);
    const closeViewer = useCallback(() => setViewing(null), []);
    const two = placement === "below";
    const failed = error && <p className="text-[13px] text-danger [overflow-wrap:anywhere]">{error.message}</p>;

    return (
        <PanelFrame
            path={path}
            placement={placement}
            onScreenFolder={onScreenFolder}
            alert={alert}
            name={inspectorName(target, level.repo, kind)}
            title={inspectorTitle(target, level.repo, kind)}
            meta={data ? sizeLine(data) : undefined}
            onClose={onClose}
        >
            {data
                ? (
                    <div className={`${BODY} ${two ? BODY_TWO : ""}`}>
                        <div className={`flex flex-col gap-3 px-4 ${two ? `${COLUMN_TWO} @min-[720px]:pr-3` : ""}`}>
                            {failed}
                            <Summary data={data} fresh={fresh} refreshing={refreshing} summaryError={summaryError} onRetry={retry} />
                            <Actions
                                data={data}
                                github={github}
                                onScreenFolder={onScreenFolder ?? false}
                                onOpen={onOpen}
                                onViewSource={() => setViewing({})}
                                onOpenInEditor={onOpenInEditor && (() => onOpenInEditor(data.path))}
                            />
                        </div>
                        <div className={`px-4 pt-4 ${two ? `${COLUMN_TWO} @min-[720px]:pl-3 @min-[720px]:pt-1` : ""}`}>
                            <Relations
                                data={data}
                                tab={tab ?? defaultTab(data)}
                                onTab={setTab}
                                onFocus={onFocus}
                                onOpen={onOpen}
                                onViewLines={DEMO
                                    ? (start, end) => { if (github) window.open(githubLink(github, data.path, { start, end }), "_blank", "noreferrer"); }
                                    : onOpenInEditor
                                        // the real editor is right there (design §4.4)
                                        ? (start) => onOpenInEditor(data.path, start)
                                        : (start, end) => setViewing({ lines: { start, end } })}
                            />
                        </div>
                    </div>
                )
                : <div className={`${BODY} px-4`}>{failed || <p className="text-[13px] text-text-2">Loading…</p>}</div>}
            {viewing && data?.kind === "file" && (
                <SourceViewer
                    path={data.path}
                    lines={viewing.lines}
                    onClose={closeViewer}
                    onOpenInEditor={onOpenInEditor && ((line) => onOpenInEditor(data.path, line))}
                />
            )}
        </PanelFrame>
    );
}

type Linked = { path: string; count: number };

/**
 * A portal selected: the page (or pages) behind it, a way to go there, and which boxes on this page have lines to it,
 * each a row that selects that box. Everything comes from the level on screen; there's nothing to fetch.
 */
function PortalPanel({ portal, path, level, onFocus, onTurnPage, onClose, placement, onScreenFolder, alert }: DetailPanelProps & { portal: MapNode }){
    const links = portalLinks(level.edges, portal.path);
    const linked = linkedFrom(level, portal.path);
    const largest = largestCount(linked);
    const pages = portal.page !== undefined ? [portal.page] : portal.pages ?? [];
    const byPath = new Map(level.nodes.map((n) => [n.path, n]));

    useEffect(() => {
        measureAfterPaint("map:select");
    }, []);

    return (
        <PanelFrame
            path={path}
            placement={placement}
            onScreenFolder={onScreenFolder}
            alert={alert}
            name={portal.name}
            title={`${portal.name} of ${level.path || nameOf("", level.repo)}`}
            meta={`${portalCaption(portal, links)} with this page`}
            onClose={onClose}
        >
            <div className={`${BODY} space-y-4 px-4`}>
                <section aria-label="Go to">
                    {pages.length > 1 && <ListHeading title="Pages behind this doorway" count={pages.length} />}
                    <ul className="flex flex-wrap gap-2">
                        {pages.map((p) => (
                            <li key={p}>
                                <button type="button" data-go-page={p} onClick={() => onTurnPage(p)} className={SECONDARY}>
                                    {p < level.page && <IconArrowLeft aria-hidden size={14} stroke={1.75} />}
                                    {pages.length === 1 ? `Go to page ${p + 1}` : `Page ${p + 1}`}
                                    {p > level.page && <IconArrowRight aria-hidden size={14} stroke={1.75} />}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                <section aria-label="Linked from this page">
                    <ListHeading title="Linked from this page" count={linked.length} />
                    <Preview items={linked} empty="No lines from this page." render={({ path: boxPath, count }: Linked) => (
                        <BarRow
                            key={boxPath}
                            linked={boxPath}
                            name={byPath.get(boxPath)?.name ?? boxPath}
                            count={count}
                            largest={largest}
                            title={`${importsTitle(boxPath, count)} with ${portal.name}`}
                            onClick={() => onFocus(boxPath)}
                        />
                    )} />
                </section>
            </div>
        </PanelFrame>
    );
}

/** A list's heading in the doorway's panel, drawn like a tab row with nothing to switch: the title, its count, a divider. */
function ListHeading({ title, count }: { title: string; count: number }){
    return (
        <h3 className="mb-2 border-b border-divider pb-2 pt-1.5 text-[13px] font-normal text-text">
            {title} <span className="text-text-2">{formatCount(count)}</span>
        </h3>
    );
}

type ActionsProps = {
    data: DescribeResponse;
    github: GitHubSource | null;
    onScreenFolder: boolean;
    onOpen: (folder: string) => void;
    onViewSource: () => void;
    /** Inside VS Code's panel only: "Open in VS Code" asks the editor over the bridge, since the panel can't follow a vscode:// link. */
    onOpenInEditor?: () => void;
};

/**
 * What you can do with the target, as buttons. A folder gets Open folder, the one primary button, unless it's the folder
 * already on screen. For a file the app offers its source and the editor; the demo has neither, so it links to GitHub
 * at the indexed commit, a folder and the repo too.
 */
function Actions({ data, github, onScreenFolder, onOpen, onViewSource, onOpenInEditor }: ActionsProps){
    const file = data.kind === "file";
    const open = data.kind === "folder" && !onScreenFolder;
    const onGithub = DEMO && github !== null;
    if (!open && !onGithub && !(file && !DEMO)) return null;

    return (
        <div className="flex flex-wrap gap-2">
            {open && <button type="button" onClick={() => onOpen(data.path)} className={PRIMARY}>Open folder</button>}
            {onGithub && (
                <a href={file ? githubLink(github, data.path) : githubFolderLink(github, data.path)} target="_blank" rel="noreferrer" className={SECONDARY}>
                    View on GitHub
                </a>
            )}
            {file && !DEMO && (
                <>
                    <button type="button" onClick={onViewSource} className={SECONDARY}>View source</button>
                    {onOpenInEditor
                        // the webview's sandbox stops a vscode:// link inside the panel, so the editor is asked instead
                        ? <button type="button" onClick={onOpenInEditor} className={SECONDARY}>Open in VS Code</button>
                        : <a href={editorLink(data)} className={SECONDARY}>Open in VS Code</a>}
                </>
            )}
        </div>
    );
}

type SummaryProps = {
    data: DescribeResponse;
    fresh: SummarizeResponse | null;
    refreshing: boolean;
    summaryError: ApiError | null;
    onRetry: () => void;
};

/**
 * The tagline and the first sentence. "Full summary" at the end of it shows the rest, and "Show less" at the end of the
 * last paragraph folds it back. Under them, quietly, whether it's refreshing, out of date, or failed (with Try again).
 */
function Summary({ data, fresh, refreshing, summaryError, onRetry }: SummaryProps){
    const [expanded, setExpanded] = useState(false);
    // a "summarize now" answer is newer than the description it was asked from
    const shown = fresh ?? data;
    const { lead, rest } = splitSummary(shown.summary ?? "");
    const failure = failureFor(shown.summaryError, summaryError);
    const placeholder = shown.tagline ? "" : summaryLine(shown.summaryStatus, summaryError);
    const paragraphs = lead === "" ? [] : expanded ? [lead, ...rest.split(/\n\s*\n/)] : [lead];
    const notes = [
        refreshing && shown.tagline ? "Refreshing…" : "",
        shown.summaryStatus === "stale" && !refreshing ? "Out of date, it changed since it was summarized." : "",
    ].filter(Boolean);
    // the summary was written from an "Imported by" line that counts tests apart; "Used by" counts them
    const testsNote = Boolean(shown.summary) && data.kind === "file";
    const hasNotes = notes.length > 0 || testsNote || failure !== null;

    return (
        // a long identifier or path (inline code is one unbroken word) breaks anywhere rather than run past the panel's
        // edge; wherever a line has a space to break at, it still breaks there
        <section aria-label="Summary" className="space-y-3 [overflow-wrap:anywhere]">
            {shown.tagline && <p className="text-[13px] font-semibold leading-[18px] text-text"><Rich text={shown.tagline} /></p>}
            {placeholder && <p className="text-[13px] leading-[1.55] text-text-2">{placeholder}</p>}
            {paragraphs.length > 0 && (
                <div className="space-y-2 text-[13px] leading-[1.55] text-text-2">
                    {paragraphs.map((paragraph, i) => (
                        <p key={i}>
                            <Rich text={paragraph} />
                            {/* it folds back, so a long summary doesn't push the tabs away for good (owner review) */}
                            {rest && i === paragraphs.length - 1 && (
                                <>
                                    {" "}
                                    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)} className={TEXT_LINK}>
                                        {expanded ? "Show less" : "Full summary"}
                                    </button>
                                </>
                            )}
                        </p>
                    ))}
                </div>
            )}
            {hasNotes && (
                <div className="space-y-1 text-[12.5px] leading-[18px] text-text-2">
                    {notes.map((note) => <p key={note}>{note}</p>)}
                    {testsNote && <p className="text-[12px] text-text-3">Import counts in this summary leave out test files.</p>}
                    {failure && (
                        <p className="text-danger">
                            {failure}{" "}
                            <button type="button" onClick={onRetry} className={TEXT_LINK}>Try again</button>
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

/**
 * Prose with its `identifiers` as inline code: the code font in the text color, with no chip behind it (the approved
 * mockup's `.summary code`, 2026-10-27). The brighter color and the code font are enough to spot a name in the gray
 * prose. The chips behind them made the summary read busy beside the new rows and bars.
 */
function Rich({ text }: { text: string }){
    return (
        <>
            {inlineCode(text).map((part, i) => part.code
                ? <code key={i} className="font-mono text-[12px] text-text">{part.text}</code>
                : <span key={i}>{part.text}</span>)}
        </>
    );
}

/** Hover titles on the tabs: the old panel's notes, said once. The three-task test's tester matched them to the arrows slowly. */
const TAB_TITLES: Record<InspectorTab, string | undefined> = {
    uses: "What this uses, by number of imports. Its arrows point to these.",
    usedBy: "What uses this, by number of imports, test files included. Their arrows point here.",
    inside: undefined,
};

type RelationsProps = {
    data: DescribeResponse;
    tab: InspectorTab;
    onTab: (tab: InspectorTab) => void;
    onFocus: (targetPath: string) => void;
    onOpen: (folder: string) => void;
    /** Opens the source viewer on a declaration's lines (or the editor, or GitHub). */
    onViewLines: (start: number, end: number) => void;
};

/**
 * The tabs (the mockup's .tabs): Uses, Used by, and Contents for a folder or Declarations for a file, each with its
 * count. A real tab list: the arrow keys, Home and End move between the tabs, and only the one on screen is in the Tab
 * order. They wrap onto a second line in a very narrow panel rather than run past its edge.
 */
function Relations({ data, tab, onTab, onFocus, onOpen, onViewLines }: RelationsProps){
    const id = useId();
    const file = data.kind === "file";
    const tabs: { id: InspectorTab; label: string; count: number }[] = [
        { id: "uses", label: "Uses", count: data.uses.length },
        { id: "usedBy", label: "Used by", count: data.usedBy.length },
        { id: "inside", label: file ? "Declarations" : "Contents", count: (file ? data.symbols?.length : data.children?.length) ?? 0 },
    ];

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const at = tabs.findIndex((t) => t.id === tab);
        const next = event.key === "ArrowRight" ? (at + 1) % tabs.length
            : event.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length
            : event.key === "Home" ? 0
            : event.key === "End" ? tabs.length - 1
            : -1;
        if (next === -1) return;
        // the Map's own ← and → turn the page: these keys are the tabs' while a tab has the focus
        event.preventDefault();
        event.stopPropagation();
        onTab(tabs[next].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    };

    return (
        <div>
            <div role="tablist" aria-label="Relationships" onKeyDown={onKeyDown} className="flex flex-wrap gap-x-[18px] border-b border-divider @max-[260px]:gap-x-3">
                {tabs.map((t) => {
                    const on = t.id === tab;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            id={`${id}-${t.id}`}
                            data-tab={t.id}
                            aria-selected={on}
                            aria-controls={`${id}-panel`}
                            tabIndex={on ? 0 : -1}
                            title={TAB_TITLES[t.id]}
                            onClick={() => onTab(t.id)}
                            className={`relative whitespace-nowrap pb-2 pt-1.5 text-[13px] ${on
                                ? "text-text after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-[1px] after:bg-accent"
                                : "text-text-2 hover:text-text"}`}
                        >
                            {t.label} {formatCount(t.count)}
                        </button>
                    );
                })}
            </div>
            <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="pt-2">
                {tab === "uses" && <Areas key="uses" items={data.uses} empty="Imports nothing outside itself." onFocus={onFocus} />}
                {tab === "usedBy" && <Areas key="usedBy" items={data.usedBy} empty="Nothing outside it imports it." onFocus={onFocus} />}
                {tab === "inside" && file && (
                    <Preview items={data.symbols ?? []} empty={noDeclarationsText(data)} render={(symbol: SymbolInfo) => (
                        <DeclarationRow key={`${symbol.name}:${symbol.startLine}`} symbol={symbol} onViewLines={onViewLines} />
                    )} />
                )}
                {tab === "inside" && !file && (
                    <Preview items={data.children ?? []} empty="Nothing inside." render={(child: MapNode) => (
                        <ChildRow key={child.path} child={child} onFocus={onFocus} onOpen={onOpen} />
                    )} />
                )}
            </div>
        </div>
    );
}

/** Uses or Used by: each area a row that focuses it on the Map, its bar measured against the tab's largest. */
function Areas({ items, empty, onFocus }: { items: readonly AreaCount[]; empty: string; onFocus: (targetPath: string) => void }){
    const largest = largestCount(items);
    return (
        <Preview items={items} empty={empty} render={(area: AreaCount) => (
            <BarRow
                key={area.path}
                chip={area.path}
                name={shortPath(area.path)}
                count={area.count}
                largest={largest}
                title={importsTitle(area.path, area.count)}
                onClick={() => onFocus(area.path)}
            />
        )} />
    );
}

type BarRowProps = {
    name: string;
    count: number;
    largest: number;
    /** Holds the name, so a name cut off with an ellipsis can be read in full. */
    title: string;
    onClick: () => void;
    /** data-chip, on Uses and Used by rows. */
    chip?: string;
    /** data-linked, on a doorway's rows. */
    linked?: string;
};

/**
 * A row with a bar (the mockup's .irow): the name in the code font, cut off with an ellipsis, the count on the right,
 * and under both a 3 px bar as long as the count is against the largest in its list.
 */
function BarRow({ name, count, largest, title, onClick, chip, linked }: BarRowProps){
    return (
        <li>
            <button
                type="button"
                data-chip={chip}
                data-linked={linked}
                title={title}
                onClick={onClick}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[5px] px-2 py-1.5 text-left hover:bg-node"
            >
                <span className="truncate font-mono text-[12.5px] leading-[18px] text-text">{name}</span>
                <span className="text-[11.5px] leading-4 text-text-2">{formatCount(count)}</span>
                <span aria-hidden className="col-span-2 mt-[5px] h-[3px] rounded-[2px] bg-linked-glyph" style={{ width: `${barWidth(count, largest)}%` }} />
            </button>
        </li>
    );
}

/** A child in Contents: a folder goes into it, a file is selected on the Map. Its icon is the explorer's. */
function ChildRow({ child, onFocus, onOpen }: { child: MapNode; onFocus: (targetPath: string) => void; onOpen: (folder: string) => void }){
    const folder = child.kind === "folder";
    const Icon = folder ? IconFolder : IconFile;
    return (
        <li>
            <button
                type="button"
                data-child={child.path}
                title={childTitle(child)}
                onClick={() => (folder ? onOpen(child.path) : onFocus(child.path))}
                className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-node"
            >
                <Icon aria-hidden size={14} stroke={1.75} className="text-text-3" />
                <span className={`truncate font-mono text-[12.5px] leading-[18px] text-text ${folder ? "" : "col-span-2"}`}>{child.name}</span>
                {folder && <span className="text-[11.5px] leading-4 text-text-2">{formatCount(child.fileCount)}</span>}
            </button>
        </li>
    );
}

/**
 * A declaration in a file: its name in the code font (brighter when it's exported), and its kind and line on the right.
 * The name keeps at least 6 characters before the place moves under it, right-aligned, in a very narrow panel.
 */
function DeclarationRow({ symbol, onViewLines }: { symbol: SymbolInfo; onViewLines: (start: number, end: number) => void }){
    return (
        <li>
            <button
                type="button"
                title={`Show ${symbol.name} in the source`}
                onClick={() => onViewLines(symbol.startLine, symbol.endLine)}
                className="flex w-full flex-wrap items-baseline gap-x-3 rounded-[5px] px-2 py-1.5 text-left hover:bg-node"
            >
                <span className={`min-w-0 flex-[1_1_6ch] truncate font-mono text-[12.5px] leading-[18px] ${symbol.exported ? "text-text" : "text-text-2"}`}>{symbol.name}</span>
                <span className="ml-auto shrink-0 whitespace-nowrap text-[11.5px] leading-4 text-text-2">{declarationPlace(symbol)}</span>
            </button>
        </li>
    );
}

type PreviewProps<T> = {
    items: readonly T[];
    /** Said in place of the list when it has no rows. */
    empty: string;
    render: (item: T) => ReactNode;
};

/** A list's first 8 rows, then "+N more" shows the rest and "Show fewer" folds it back. */
function Preview<T>({ items, empty, render }: PreviewProps<T>){
    const [all, setAll] = useState(false);
    if (items.length === 0) return <p className="px-2 py-1.5 text-[13px] text-text-2">{empty}</p>;

    return (
        <>
            {/* a plain block, not a grid: an auto grid track would widen to a long declaration's whole name */}
            <ul className="space-y-0.5">{(all ? items : items.slice(0, PREVIEW)).map(render)}</ul>
            {items.length > PREVIEW && (
                <button type="button" aria-expanded={all} onClick={() => setAll((open) => !open)} className={QUIET}>
                    {all ? "Show fewer" : `+${formatCount(items.length - PREVIEW)} more`}
                </button>
            )}
        </>
    );
}
