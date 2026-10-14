"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import { DEMO } from "./mode";

/**
 * How to use the Map (owner review: "it's kinda confusing at first as to what all of this does"). Opens from the top
 * bar's "?" button or the ? key, and by itself on a first visit. Rendered into the page's body, above everything;
 * Escape or a click outside closes it. In the static demo it opens with what the demo can't do (ADR-049).
 */
export default function HelpDialog({ onClose }: { onClose: () => void }){
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    return createPortal(
        <div data-testid="help" className="fixed inset-0 z-50 grid place-items-center bg-canvas/70 p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-label="How to use the Map"
                onClick={(event) => event.stopPropagation()}
                className="max-h-[85vh] w-[760px] max-w-full overflow-y-auto rounded-lg border border-border bg-panel p-6"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[18px] font-medium text-text">How to use the Map</h2>
                        {DEMO && (
                            <p className="mt-1 text-[14px] text-text-2">
                                This is a static demo of the Map, built from a frozen index. Search covers names and summaries. Source links open
                                GitHub at the commit the index was built from. Claude Code&apos;s live activity and fresh summaries need Nebulosity
                                running on your machine.
                            </p>
                        )}
                        <p className="mt-1 text-[14px] text-text-2">
                            A map of the repo&apos;s folders and files, and of which code imports which. Open this again with the ? button
                            at the top right, or the ? key.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close help" className="shrink-0 rounded-md p-1 text-text-2 hover:bg-surface hover:text-text">
                        <IconX aria-hidden size={16} stroke={1.75} />
                    </button>
                </div>

                <div className="mt-6 grid gap-x-8 gap-y-6 text-[14px] leading-normal text-text sm:grid-cols-2">
                    <Section title="Getting around">
                        <li><b>Click</b> a box to see what it is, in the panel on the right.</li>
                        <li><b>Double-click</b> a folder to go inside it.</li>
                        <li>Go back up with the path at the top left, <Key>Backspace</Key>, or your browser&apos;s Back button. The repo&apos;s name at the very top goes back to the start.</li>
                        <li>Big folders are split into pages of related boxes: turn the page with the arrows at the top right, or <Key>←</Key> <Key>→</Key>.</li>
                        <li>A busy folder opens at a readable size, from its top: drag to see the rest, or press the fit button at the bottom right to see it all.</li>
                        <li>Search files and concepts with <Key>Ctrl K</Key> (<Key>⌘K</Key> on a Mac).</li>
                    </Section>
                    <Section title="Reading the Map">
                        <li>A box is a folder (with how many files it holds) or a file.</li>
                        <li>A line from A to B means A uses code from B: the arrow points at what&apos;s being used. A box&apos;s panel lists both sides: <b>Depends on</b> (what it uses) and <b>Used by</b> (what uses it).</li>
                        <li>Hover a box to see its summary and preview its lines. Hover a line to read it as a sentence, like &quot;editor uses base · 12 imports&quot;.</li>
                        <li>Busy folders (more than 60 lines) draw only the lines of the box you hover or select. <b>Show all lines</b>, at the top right, brings back the rest.</li>
                        <li>Boxes with no lines on the page sit under a line that says &quot;Not linked to anything on this page&quot;.</li>
                        <li>Lines to other pages end at a doorway, a dashed box like &quot;Lines to page 2&quot;; double-click it to go there.</li>
                    </Section>
                    <Section title="Colors">
                        <li><Swatch className="border-2 border-select bg-select-fill" /> Purple: the box you selected and its lines. Everything else fades.</li>
                        <li><Swatch className="outline-2 outline-offset-1 outline-agent" /> Orange: what Claude Code is touching right now.</li>
                        <li><Swatch className="rounded-full bg-control" /> Cyan: something you can click, like a link or the Map&apos;s buttons.</li>
                        <li><Swatch className="rounded-full bg-ok" /> Green: the index is up to date.</li>
                        <li><Swatch className="rounded-full bg-danger" /> Red: something failed.</li>
                    </Section>
                    <Section title="The details panel">
                        <li>A short summary; <b>Read full summary</b> shows the rest.</li>
                        <li><b>Depends on</b> and <b>Used by</b>: click one to jump to it on the Map.</li>
                        <li><b>Contents</b>: click a folder to go in, or a file to select it.</li>
                        {DEMO
                            ? <li>For a file, <b>View on GitHub</b> opens its code at the indexed commit; click a declaration to open it there.</li>
                            : <li>For a file, <b>View source</b> shows its code; click a declaration to jump to it there.</li>}
                    </Section>
                    <Section title="Claude Code">
                        {DEMO
                            ? <li>In the app, the bar along the bottom shows Claude Code&apos;s last 3 tool calls, and the boxes they touched get an orange ring.</li>
                            : (
                                <>
                                    <li>The bar along the bottom shows Claude Code&apos;s last 3 tool calls, newest first.</li>
                                    <li>Boxes holding what it touched get an orange ring for 30 seconds.</li>
                                </>
                            )}
                    </Section>
                    <Section title="The index">
                        <li>The status at the top right says whether the index is up to date. Click it for each stage{DEMO ? "." : ", and to re-index."}</li>
                    </Section>
                </div>

                <h3 className="mt-6 text-[13px] font-medium text-title">Keyboard</h3>
                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px] text-text-2">
                    <dt><Key>Ctrl K</Key></dt><dd>Search files and concepts</dd>
                    <dt><Key>Esc</Key></dt><dd>Close what&apos;s open, or let go of the selection</dd>
                    <dt><Key>Backspace</Key></dt><dd>Up one folder</dd>
                    <dt><Key>←</Key> <Key>→</Key></dt><dd>Previous or next page of a big folder</dd>
                    <dt><Key>?</Key></dt><dd>This help</dd>
                </dl>
            </div>
        </div>,
        document.body,
    );
}

function Section({ title, children }: { title: string; children: ReactNode }){
    return (
        <section>
            <h3 className="text-[13px] font-medium text-title">{title}</h3>
            <ul className="mt-2 space-y-1.5 text-text-body [&_b]:font-medium [&_b]:text-text">{children}</ul>
        </section>
    );
}

function Key({ children }: { children: ReactNode }){
    return <kbd className="rounded-md border border-border bg-surface px-1.5 py-px font-sans text-[12px] text-text">{children}</kbd>;
}

function Swatch({ className }: { className: string }){
    return <span aria-hidden className={`mr-1 inline-block h-3 w-3 rounded-sm align-[-1px] ${className}`} />;
}
