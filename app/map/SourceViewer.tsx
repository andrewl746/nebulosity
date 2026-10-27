"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconExternalLink, IconX } from "@tabler/icons-react";
import type { SourceResponse } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { formatCount } from "./format";
import { editorLink } from "./links";
import { nameOf } from "./paths";
import { tooLargeToColor } from "./text";
import { useScrollLock } from "./useScrollLock";

/** Each line's height in px: the gutter, the code and the highlighted range all use it, so they line up. */
const LINE_HEIGHT = 20;

/** "Open in VS Code" as the inspector's secondary button (DetailPanel's SECONDARY), not an underlined link. */
const SECONDARY = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border px-3 text-[13px] text-text hover:border-text-3";

type SourceViewerProps = {
    path: string;
    /** The lines to highlight and scroll to: a declaration picked in the panel. */
    lines?: { start: number; end: number };
    onClose: () => void;
    /**
     * Inside VS Code's panel only: "Open in VS Code" asks the editor over the bridge (at the highlighted line), since the
     * panel can't follow a vscode:// link.
     */
    onOpenInEditor?: (line?: number) => void;
};

/**
 * A file's source, read-only (owner review: "an option to view all the source code for a file"). It opens as a
 * drawer over the canvas, from the file's panel or one of its declarations, which it scrolls to and highlights.
 * Rendered into the page's body, so the panel it opens from can't clip it. Escape closes it and nothing else.
 */
export default function SourceViewer({ path, lines, onClose, onOpenInEditor }: SourceViewerProps){
    useScrollLock();
    const [source, setSource] = useState<SourceResponse | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const scroller = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const controller = new AbortController();
        api.source(path, controller.signal).then(setSource, (err: unknown) => { if (err instanceof ApiError) setError(err); });
        return () => controller.abort();
    }, [path]);

    // the picked declaration, a few lines from the top
    useEffect(() => {
        if (source && lines && scroller.current) scroller.current.scrollTop = Math.max(0, (lines.start - 4) * LINE_HEIGHT);
    }, [source, lines]);

    // Escape closes the viewer only: caught before the Map's own Escape (which would also clear the selection)
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    // Windows line endings become plain ones: a carriage return has no business on screen
    const text = source?.content.replace(/\r\n/g, "\n").replace(/\n$/, "") ?? "";

    // VS Code's colors (owner review), from a module loaded only when a viewer opens, so the Map's own bundle doesn't
    // carry the highlighter. Until it lands the text shows plain.
    const [highlighted, setHighlighted] = useState<{ text: string; html: string } | null>(null);
    useEffect(() => {
        if (!source) return;
        let live = true;
        void import("./syntax").then(({ highlightCode }) => {
            if (live) setHighlighted({ text, html: highlightCode(text, source.language) });
        });
        return () => { live = false; };
    }, [source, text]);
    const count = source?.lineCount ?? 0;
    const editorHref = source ? editorLink(source, lines?.start) : undefined;

    return createPortal(
        <div data-source-viewer={path} className="fixed inset-0 z-40 bg-canvas/60" onClick={onClose}>
            <div
                role="dialog"
                aria-label={`Source of ${path}`}
                onClick={(event) => event.stopPropagation()}
                // a narrow window (under 600 px) gives it the whole width: 80% of it would leave too little code
                className="absolute inset-y-0 right-0 flex w-[min(960px,80vw)] flex-col border-l border-divider bg-panel max-[600px]:w-full"
            >
                {/* the inspector's header: the name in the code font, the path, what's shown, and the editor as a button */}
                <header className="flex shrink-0 items-start justify-between gap-2 border-b border-divider px-4 pb-3 pt-4">
                    <div className="min-w-0">
                        <h2 title={path} className="truncate font-mono text-[15px] font-medium leading-5 text-text">{nameOf(path, "")}</h2>
                        <div className="truncate font-mono text-[12px] leading-[18px] text-text-3" title={path}>{path}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] leading-[18px] text-text-2">
                            {source && <span>{formatCount(count)} {count === 1 ? "line" : "lines"}</span>}
                            {source?.truncated && <span>Only the first 1 MB is shown.</span>}
                            {source && tooLargeToColor(text) && <span data-testid="source-plain">Shown without colors, too large to color quickly.</span>}
                            {lines && <span>Lines {lines.start}–{lines.end} highlighted</span>}
                            {editorHref && (onOpenInEditor
                                ? (
                                    <button type="button" onClick={() => onOpenInEditor(lines?.start)} className={SECONDARY}>
                                        Open in VS Code <IconExternalLink aria-hidden size={14} stroke={1.75} />
                                    </button>
                                )
                                : (
                                    <a href={editorHref} className={SECONDARY}>
                                        Open in VS Code <IconExternalLink aria-hidden size={14} stroke={1.75} />
                                    </a>
                                ))}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close the source" className="-mr-1 shrink-0 rounded-[5px] p-1 text-text-2 hover:bg-node hover:text-text">
                        <IconX aria-hidden size={16} stroke={1.75} />
                    </button>
                </header>
                {/* long lines scroll sideways here, as in an editor (data-scroll-x: the layout check expects it) */}
                <div ref={scroller} data-scroll-x className="min-h-0 flex-1 overflow-auto">
                    {error && <p className="px-4 py-3 text-[13px] text-danger [overflow-wrap:anywhere]">{error.message}</p>}
                    {!source && !error && <p className="px-4 py-3 text-[13px] text-text-2">Loading…</p>}
                    {source && (
                        <div className="relative flex min-w-max font-mono text-[13px]" style={{ lineHeight: `${LINE_HEIGHT}px` }}>
                            {lines && (
                                <div
                                    aria-hidden
                                    className="absolute inset-x-0 bg-node"
                                    style={{ top: (lines.start - 1) * LINE_HEIGHT + 12, height: (lines.end - lines.start + 1) * LINE_HEIGHT }}
                                />
                            )}
                            {/* the line numbers stay put as the code scrolls sideways, quieter than the code, as in the editor */}
                            <pre aria-hidden className="sticky left-0 select-none bg-panel py-3 pl-4 pr-3 text-right text-text-3">
                                {Array.from({ length: count }, (_, i) => i + 1).join("\n")}
                            </pre>
                            {highlighted?.text === text
                                // highlightCode escapes the file's text, so this HTML is only its spans (syntax.ts)
                                ? <pre className="syntax relative py-3 pr-6" dangerouslySetInnerHTML={{ __html: highlighted.html }} />
                                : <pre className="syntax relative py-3 pr-6">{text}</pre>}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
