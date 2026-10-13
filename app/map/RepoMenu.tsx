"use client";

import { useEffect, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { RepoList, RepoSummary } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { useDismiss } from "./useDismiss";

type RepoMenuProps = { repo: string; onSwitched: () => void; /** Go to the repo's top level. */ onHome: () => void };

/** A repo as the top bar names it: "owner / repo" from its origin, or its folder name (VISUAL_REFRESH.md §6). */
function RepoName({ entry, fallback }: { entry: RepoSummary | undefined; fallback: string }){
    if (!entry?.remote) return <span className="truncate text-[15px] font-medium text-text">{fallback}</span>;
    return (
        <span className="flex min-w-0 items-baseline gap-1 text-[15px]">
            <span className="truncate text-text-2">{entry.remote.owner}</span>
            <span aria-hidden className="text-text-2">/</span>
            <span className="truncate font-medium text-text">{entry.remote.name}</span>
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
    const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

    useEffect(() => {
        api.repos().then(setList, () => {});
    }, [repo]);

    const name = repo.slice(repo.lastIndexOf("/") + 1);
    const label = <RepoName entry={list?.repos.find((r) => r.root === repo)} fallback={name} />;
    const home = (
        <button type="button" data-testid="repo-name" onClick={onHome} title="Go to the top level" className="flex min-w-0 rounded-md px-1 hover:bg-surface">
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
                    onClick={() => setOpen((o) => !o)}
                    aria-label="Switch repository"
                    title="Switch repository"
                    className="grid h-7 w-6 shrink-0 place-items-center rounded-md text-text-2 hover:bg-surface hover:text-text"
                >
                    <IconChevronDown aria-hidden size={14} stroke={1.75} />
                </button>
            </div>
            {open && (
                <ul className="absolute left-0 top-9 z-30 w-[320px] rounded-lg border border-border bg-surface py-1 text-[13px]">
                    {list.repos.map((r) => (
                        <li key={r.root}>
                            <button type="button" onClick={() => pick(r.root)} className="block w-full px-3 py-2 text-left hover:bg-border">
                                <span className={r.root === repo ? "font-medium text-text" : "text-text"}>{r.remote ? `${r.remote.owner} / ${r.remote.name}` : r.name}</span>
                                <span className="block truncate font-mono text-[12px] text-text-2">{r.root}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <span className="ml-2 text-[12px] text-danger">{error}</span>}
        </div>
    );
}
