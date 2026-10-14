"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconFile, IconFolder, IconSearch } from "@tabler/icons-react";
import type { SearchHit, SearchResult } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { formatCount } from "./format";
import { languageFor } from "./paths";
import { codeLabel, groupHits } from "./searchHits";

type SearchPaletteProps = { onPick: (hit: SearchHit) => void; onClose: () => void };

/** Results asked for per query (enough to fill both groups; the list scrolls), and how long typing must pause. */
const LIMIT = 40;
const DEBOUNCE_MS = 150;

/**
 * ⌘K (PIVOT_SPEC.md §7): hybrid search over files, symbols, summaries, folder names and file names (GET /api/search).
 * Folders come first, then files, each under a heading with its count (searchHits.ts). Arrow keys move through both,
 * Enter picks, Escape closes. Picking moves the Map to the result's level and selects it. MapView mounts it only while
 * open, so each opening starts empty.
 */
export default function SearchPalette({ onPick, onClose }: SearchPaletteProps){
    const [query, setQuery] = useState("");
    const [result, setResult] = useState<SearchResult | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLUListElement>(null);
    // the code lines take VS Code's colors once the highlighter loads (owner review); plain until then
    const [highlight, setHighlight] = useState<((code: string, language: string) => string) | null>(null);

    useEffect(() => {
        input.current?.focus();
        let live = true;
        void import("./syntax").then((syntax) => {
            if (live) setHighlight(() => (code: string, language: string) => syntax.highlightCode(code, language));
        });
        return () => { live = false; };
    }, []);

    useEffect(() => {
        const q = query.trim();
        if (q === "") return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            api.search(q, LIMIT, controller.signal).then(
                (next) => { setResult(next); setError(null); setActive(0); },
                (err: unknown) => { if (err instanceof ApiError) setError(err); },
            );
        }, DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    // results for an older query, or for an empty box, show nothing
    const groups = groupHits(result !== null && result.query === query.trim() ? result.hits : []);
    const hits = groups.ordered;
    const current = Math.min(active, hits.length - 1);

    // the arrow keys can walk past the bottom of a long list: keep the highlighted row in view
    useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }, [current]);

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === "Escape") onClose();
        else if (event.key === "ArrowDown"){
            event.preventDefault();
            setActive(Math.min(current + 1, hits.length - 1));
        } else if (event.key === "ArrowUp"){
            event.preventDefault();
            setActive(Math.max(current - 1, 0));
        } else if (event.key === "Enter" && hits[current]) onPick(hits[current]);
    };

    return (
        <div className="pointer-events-auto fixed inset-0 z-30 bg-canvas/70" onClick={onClose}>
            <div role="dialog" aria-label="Search" onClick={(event) => event.stopPropagation()}
                className="mx-auto mt-[12vh] w-[640px] max-w-[92vw] overflow-hidden rounded-lg border border-border bg-panel">
                <div className="flex items-center gap-3 border-b border-hairline px-4">
                    <IconSearch aria-hidden size={16} stroke={1.75} className="shrink-0 text-text-2" />
                    <input
                        ref={input}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Search files and concepts"
                        spellCheck={false}
                        aria-label="Search"
                        className="w-full bg-transparent py-3 text-[15px] text-text placeholder:text-text-2 focus:outline-none"
                    />
                </div>
                {error && <p className="px-4 py-3 text-[13px] text-danger">{error.message}</p>}
                {result?.note && hits.length > 0 && <p className="px-4 pt-2 text-[12px] text-text-2">{result.note}</p>}
                <ul ref={list} role="listbox" className="max-h-[52vh] overflow-y-auto py-1">
                    {hits.map((hit, i) => (
                        <Fragment key={hit.path}>
                            {(i === 0 || i === groups.folders.length) && (
                                <li role="presentation" className="px-4 pb-1 pt-2 text-[12px] font-medium text-text-2">
                                    {hit.kind === "folder" ? "Folders" : "Files"}{" "}
                                    <span className="font-normal">{formatCount(hit.kind === "folder" ? groups.folders.length : groups.files.length)}</span>
                                </li>
                            )}
                            <li role="option" aria-selected={i === current}>
                                <button
                                    type="button"
                                    data-hit={hit.path}
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => onPick(hit)}
                                    className={`flex w-full gap-3 px-4 py-2 text-left ${i === current ? "bg-surface" : ""}`}
                                >
                                    {hit.kind === "folder"
                                        ? <IconFolder aria-hidden size={16} stroke={1.75} className="mt-0.5 shrink-0 text-folder" />
                                        : <IconFile aria-hidden size={16} stroke={1.75} className="mt-0.5 shrink-0 text-text-2" />}
                                    <span className="min-w-0 flex-1">
                                        <span title={hit.path} className="block truncate font-mono text-[13px] text-text">{hit.path}</span>
                                        {hit.tagline && <span title={hit.tagline} className="block truncate text-[13px] text-text-2">{hit.tagline}</span>}
                                        {hit.code && (
                                            <span className="block truncate font-mono text-[12px] text-text-2">
                                                {codeLabel(hit.code)}:{" "}
                                                {highlight
                                                    // highlightCode escapes the snippet, so this HTML is only its spans (syntax.ts)
                                                    ? <span className="syntax" dangerouslySetInnerHTML={{ __html: highlight(hit.code.snippet, languageFor(hit.path)) }} />
                                                    : <span className="syntax">{hit.code.snippet}</span>}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            </li>
                        </Fragment>
                    ))}
                    {query.trim() !== "" && result !== null && result.query === query.trim() && hits.length === 0 && (
                        <li className="px-4 py-3 text-[13px] text-text-2">{result.note ?? "Nothing matched."}</li>
                    )}
                </ul>
            </div>
        </div>
    );
}
