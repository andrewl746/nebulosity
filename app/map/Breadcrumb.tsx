"use client";

import { nameOf } from "./paths";

type BreadcrumbProps = { repo: string; trail: readonly string[]; onOpen: (folder: string) => void };

/** Where the Map is: the repo, then each folder down to the one on screen. Every step but the last opens it. */
export default function Breadcrumb({ repo, trail, onOpen }: BreadcrumbProps){
    return (
        <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-zinc-400">
            {trail.map((step, i) => (
                <span key={step || "(root)"} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <span aria-hidden className="text-zinc-600">›</span>}
                    {i === trail.length - 1
                        ? <span aria-current="page" className="truncate text-zinc-100">{nameOf(step, repo)}</span>
                        : <button type="button" onClick={() => onOpen(step)} className="truncate hover:text-purple-200">{nameOf(step, repo)}</button>}
                </span>
            ))}
        </nav>
    );
}
