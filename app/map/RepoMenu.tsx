"use client";

import { useEffect, useState } from "react";
import type { RepoList } from "@/lib/contracts";
import { api, ApiError } from "./api";

type RepoMenuProps = { repo: string; onSwitched: () => void };

/** The repo's name, and a picker when more than one repo is indexed (PIVOT_SPEC.md §7.1). */
export default function RepoMenu({ repo, onSwitched }: RepoMenuProps){
    const [list, setList] = useState<RepoList | null>(null);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.repos().then(setList, () => {});
    }, [repo]);

    const name = repo.slice(repo.lastIndexOf("/") + 1);
    const label = <span className="truncate font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-300">{name}</span>;
    if (list === null || list.repos.length < 2) return label;

    const pick = (root: string): void => {
        setOpen(false);
        if (root === repo) return;
        api.setActiveRepo(root).then(onSwitched, (err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't switch repos."));
    };

    return (
        <div className="relative">
            <button type="button" data-testid="repo-menu" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 hover:text-purple-200">
                {label}
                <span aria-hidden className="text-[10px] text-zinc-500">▾</span>
            </button>
            {open && (
                <ul className="absolute left-0 top-8 z-30 w-[320px] rounded-sm border border-purple-400/25 bg-[#0c0716]/95 py-1 font-mono text-[11px] shadow-[0_0_30px_rgba(126,58,242,0.2)]">
                    {list.repos.map((r) => (
                        <li key={r.root}>
                            <button type="button" onClick={() => pick(r.root)} className={`block w-full px-3 py-1.5 text-left hover:bg-purple-500/15 ${r.root === repo ? "text-purple-200" : "text-zinc-300"}`}>
                                {r.name}
                                <span className="block truncate text-[10px] text-zinc-600">{r.root}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <span className="ml-2 text-[10px] text-red-300">{error}</span>}
        </div>
    );
}
