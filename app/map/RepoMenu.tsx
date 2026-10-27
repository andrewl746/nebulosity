"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { RepoList, RepoSummary } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { placePopover, usePlaceOnResize } from "./popover";
import { useDismiss } from "./useDismiss";

/** The repo list's width, at normal sizes (narrower only when the Map is). */
const LIST_WIDTH = 320;

type RepoMenuProps = { repo: string; onSwitched: () => void; /** Go to the repo's top level. */ onHome: () => void };

/** A repo as the breadcrumb names it, in mono: "owner/repo" from its origin, or its folder name (ADR-070). */
function RepoName({ entry, fallback }: { entry: RepoSummary | undefined; fallback: string }){
    if (!entry?.remote) return <span title={fallback} className="truncate text-text">{fallback}</span>;
    // in a narrow window the owner gives way first, whole (the breadcrumb says when, by data-owner, and narrows it to
    // nothing so it can still be measured; under 360 px it's gone), so the repo's own name keeps its room; the name
    // truncates only once it alone is too wide. The whole name is the hover title.
    return (
        <span title={`${entry.remote.owner}/${entry.remote.name}`} className="flex min-w-0 items-baseline text-text">
            <span data-repo-owner className="truncate after:content-['/'] group-data-[owner=hidden]/crumb:max-w-0 max-[360px]:hidden">{entry.remote.owner}</span>
            <span className="max-w-full shrink-0 truncate">{entry.remote.name}</span>
        </span>
    );
}

/**
 * The repo's name, which goes to the top level (the three-task test's tester clicked it expecting that, and nothing
 * happened), and a ▾ that opens a picker when more than one repo is indexed (PIVOT_SPEC.md §7.1).
 */
export default function RepoMenu({ repo, onSwitched, onHome }: RepoMenuProps){
    const [list, setList] = useState<RepoList | null>(null);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // where the list opens, worked out as it opens and as the window resizes: under the name, kept inside a narrow Map
    // (popover.ts)
    const [listPlace, setListPlace] = useState<CSSProperties>({ left: 0, width: LIST_WIDTH });
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
    const place = useCallback(() => {
        if (ref.current) setListPlace(placePopover(ref.current, LIST_WIDTH, "start"));
    }, [ref]);
    usePlaceOnResize(open, place);

    useEffect(() => {
        api.repos().then(setList, () => {});
    }, [repo]);

    const name = repo.slice(repo.lastIndexOf("/") + 1);
    const label = <RepoName entry={list?.repos.find((r) => r.root === repo)} fallback={name} />;
    const home = (
        <button type="button" data-testid="repo-name" onClick={onHome} title="Go to the top level" className="flex min-w-0 rounded-[4px] px-0.5 hover:bg-node">
            {label}
        </button>
    );
    if (list === null || list.repos.length < 2) return home;

    const pick = (root: string): void => {
        setOpen(false);
        if (root === repo) return;
        api.setActiveRepo(root).then(onSwitched, (err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't switch repos."));
    };

    return (
        <div ref={ref} className="relative min-w-0">
            <div className="flex min-w-0 items-center">
                {home}
                <button
                    type="button"
                    data-testid="repo-menu"
                    onClick={() => {
                        if (!open) place();
                        setOpen((o) => !o);
                    }}
                    aria-label="Switch repository"
                    title="Switch repository"
                    className="grid h-6 w-5 shrink-0 place-items-center rounded-[4px] text-text-3 hover:bg-node hover:text-text"
                >
                    <IconChevronDown aria-hidden size={14} stroke={1.75} />
                </button>
            </div>
            {open && (
                <ul data-testid="repo-list" data-covers style={listPlace} className="absolute top-8 z-30 overflow-y-auto rounded-md border border-border bg-panel py-1 font-sans text-[13px]">
                    {list.repos.map((r) => (
                        <li key={r.root}>
                            <button type="button" onClick={() => pick(r.root)} className="block w-full px-3 py-2 text-left hover:bg-node">
                                <span className={r.root === repo ? "font-medium text-text" : "text-text"}>{r.remote ? `${r.remote.owner} / ${r.remote.name}` : r.name}</span>
                                <span title={r.root} className="block truncate font-mono text-[12px] text-text-3">{r.root}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <span title={error} className="ml-2 block truncate text-[12px] text-danger">{error}</span>}
        </div>
    );
}
