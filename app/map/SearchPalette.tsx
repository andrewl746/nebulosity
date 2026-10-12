"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SearchHit, SearchResult } from "@/lib/contracts";
import { api, ApiError } from "./api";

type SearchPaletteProps = { onPick: (hit: SearchHit) => void; onClose: () => void };

/** Results asked for per query, and how long typing must pause before a query goes out. */
const LIMIT = 12;
const DEBOUNCE_MS = 150;

/**
 * ⌘K (PIVOT_SPEC.md §7): hybrid search over files, symbols and summaries (GET /api/search). Arrow keys move, Enter
 * picks, Escape closes. Picking moves the Map to the result's level and selects it. MapView mounts it only while
 * open, so each opening starts empty.
 */
export default function SearchPalette({ onPick, onClose }: SearchPaletteProps){
    const [query, setQuery] = useState("");
    const [result, setResult] = useState<SearchResult | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        input.current?.focus();
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
    const hits = result !== null && result.query === query.trim() ? result.hits : [];
    const current = Math.min(active, hits.length - 1);

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
        <div className="pointer-events-auto fixed inset-0 z-30 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div role="dialog" aria-label="Search" onClick={(event) => event.stopPropagation()}
                className="mx-auto mt-[12vh] w-[600px] max-w-[92vw] overflow-hidden rounded-sm border border-purple-400/30 bg-[#0c0716]/95 font-mono shadow-[0_0_40px_rgba(126,58,242,0.25)]">
                <input
                    ref={input}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search files, symbols and summaries…"
                    spellCheck={false}
                    aria-label="Search"
                    className="w-full border-b border-purple-400/20 bg-transparent px-4 py-3 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                />
                {error && <p className="px-4 py-3 text-[11px] text-red-300">{error.message}</p>}
                {result?.note && hits.length > 0 && <p className="px-4 pt-2 text-[10.5px] text-amber-200/70">{result.note}</p>}
                <ul role="listbox" className="max-h-[52vh] overflow-y-auto py-1">
                    {hits.map((hit, i) => (
                        <li key={hit.path} role="option" aria-selected={i === current}>
                            <button
                                type="button"
                                data-hit={hit.path}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => onPick(hit)}
                                className={`block w-full px-4 py-2 text-left ${i === current ? "bg-purple-500/15" : ""}`}
                            >
                                <span className="text-[12px] text-zinc-100">{hit.path}{hit.kind === "folder" ? "/" : ""}</span>
                                {hit.tagline && <span className="block truncate text-[10.5px] text-zinc-400">{hit.tagline}</span>}
                                {hit.code && (
                                    <span className="block truncate text-[10.5px] text-zinc-500">
                                        {hit.code.symbol} · lines {hit.code.startLine}–{hit.code.endLine}: {hit.code.snippet}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                    {query.trim() !== "" && result !== null && result.query === query.trim() && hits.length === 0 && (
                        <li className="px-4 py-3 text-[11px] text-zinc-500">{result.note ?? "Nothing matched."}</li>
                    )}
                </ul>
            </div>
        </div>
    );
}
