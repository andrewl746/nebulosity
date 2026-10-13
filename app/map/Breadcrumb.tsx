"use client";

import { nameOf } from "./paths";

type BreadcrumbProps = { repo: string; trail: readonly string[]; onOpen: (folder: string) => void };

/** Where the Map is: "vscode / src / vs" (VISUAL_REFRESH.md §4). Every step but the last goes back up to it. */
export default function Breadcrumb({ repo, trail, onOpen }: BreadcrumbProps){
    return (
        <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1 text-[14px] text-text-2">
            {trail.map((step, i) => (
                <span key={step || "(root)"} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <span aria-hidden>/</span>}
                    {i === trail.length - 1
                        ? <span aria-current="page" className="truncate px-1 font-medium text-text">{nameOf(step, repo)}</span>
                        : <button type="button" onClick={() => onOpen(step)} className="truncate rounded-md px-1 hover:bg-surface hover:text-text">{nameOf(step, repo)}</button>}
                </span>
            ))}
        </nav>
    );
}
