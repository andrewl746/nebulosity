"use client";

import { useEffect, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { RepoList, RepoSummary } from "@/lib/contracts";
import { api, ApiError } from "./api";

type RepoMenuProps = { repo: string; onSwitched: () => void };

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

/** The repo's name, and a picker when more than one repo is indexed (PIVOT_SPEC.md §7.1). */
export default function RepoMenu({ repo, onSwitched }: RepoMenuProps){
    const [list, setList] = useState<RepoList | null>(null);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.repos().then(setList, () => {});
    }, [repo]);

    const name = repo.slice(repo.lastIndexOf("/") + 1);
    const label = <RepoName entry={list?.repos.find((r) => r.root === repo)} fallback={name} />;
    if (list === null || list.repos.length < 2) return <span data-testid="repo-name" className="flex min-w-0">{label}</span>;

    const pick = (root: string): void => {
        setOpen(false);
        if (root === repo) return;
        api.setActiveRepo(root).then(onSwitched, (err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't switch repos."));
    };

    return (
        <div className="relative min-w-0">
            <button type="button" data-testid="repo-menu" onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-1 rounded-md px-1 hover:bg-surface">
                {label}
                <IconChevronDown aria-hidden size={14} stroke={1.75} className="shrink-0 text-text-2" />
            </button>
            {open && (
                <ul className="absolute left-0 top-9 z-30 w-[320px] rounded-lg border border-border bg-panel py-1 text-[13px]">
                    {list.repos.map((r) => (
                        <li key={r.root}>
                            <button type="button" onClick={() => pick(r.root)} className="block w-full px-3 py-2 text-left hover:bg-surface">
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
