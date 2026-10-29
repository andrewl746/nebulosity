"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import { DEMO } from "./mode";
import { useScrollLock } from "./useScrollLock";

/**
 * How to use the Map (owner review: "it's kinda confusing at first as to what all of this does"). Opens from the
 * header's "?" button, the toolbar's … menu where there's no room for it, or the ? key. It no longer opens by itself on
 * a first visit, since the legend sentence under the canvas says what the marks mean (ADR-070). Rendered into the
 * page's body, above everything; Escape or a click outside closes it. In the static demo it opens with what the demo
 * can't do (ADR-049).
 */
export default function HelpDialog({ onClose }: { onClose: () => void }){
    useScrollLock();
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    // flex, not grid, centers it: a grid's column grows to the dialog's 760 px, so max-w-full never shrank it, and a
    // narrow window (VS Code's panel) cut its text off at the right. In a flex row the dialog narrows and its text wraps.
    // It's fixed to the window, outside the Map's floor (narrow.ts), so a window narrower than the floor gets a tighter
    // dialog: less padding, and the keyboard list's keys above what they do.
    return createPortal(
        <div data-testid="help" className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 max-[360px]:p-2" onClick={onClose}>
            <div
                role="dialog"
                aria-label="How to use the Map"
                onClick={(event) => event.stopPropagation()}
                className="max-h-[85vh] w-[760px] max-w-full overflow-y-auto rounded-lg border border-border bg-panel p-6 max-[360px]:p-4"
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
                    <button type="button" onClick={onClose} aria-label="Close help" className="shrink-0 rounded-md p-1 text-text-2 hover:bg-node hover:text-text">
                        <IconX aria-hidden size={16} stroke={1.75} />
                    </button>
                </div>

                <div className="mt-6 grid gap-x-8 gap-y-6 text-[14px] leading-normal text-text sm:grid-cols-2">
                    <Section title="Getting around">
                        <li><b>Click</b> a box to see what it is, in the inspector beside or under the Map.</li>
                        <li><b>Double-click</b> a folder to go inside it, or click a folder in the explorer on the left.</li>
                        <li>Go back up with the path at the top left, <Key>Backspace</Key>, or your browser&apos;s Back button. The repo&apos;s name at its start goes back to the top.</li>
                        <li>Big folders are split into pages of related boxes. Turn the page with the arrows in the toolbar, or <Key>←</Key> <Key>→</Key>.</li>
                        <li>A busy folder opens at a readable size, from its top. Drag to see the rest, or press <b>Fit</b> in the toolbar to see it all.</li>
                        <li>Search files and concepts with <Key>Ctrl K</Key> (<Key>⌘K</Key> on a Mac).</li>
                    </Section>
                    <Section title="Reading the Map">
                        <li>A box is a folder or a file. A folder&apos;s dot grows with how many files it holds, and it has a second card behind it. A file has a page.</li>
                        <li>A line from A to B means A uses code from B, and the arrow points at what&apos;s being used. Its weight, and the number on it, show how many imports it carries.</li>
                        <li>Hover a box to bring its lines forward. Hover a line to read it as a sentence, like &quot;editor uses base, 12 imports&quot;.</li>
                        <li><b>Strong links only</b>, in the toolbar, hides the lines under 2% of the heaviest line&apos;s imports. Every line of the box you select or hover still shows.</li>
                        <li>With a box selected, <b>Uses</b> or <b>Used by</b> in the toolbar keeps only its lines to what it uses, or from what uses it, in color, and turns its other lines gray. <b>All</b> colors both, and it&apos;s back to All when you select something else.</li>
                        <li>Busy folders (more than 60 lines) draw only the lines of the box you hover or select, until you ask for <b>Show all lines</b>.</li>
                        <li>Boxes with no lines on the page sit under a line that says &quot;Not linked to anything here&quot;. Lines to other pages end at a doorway, a dashed box like &quot;Lines to page 2&quot;, and double-clicking it goes there.</li>
                    </Section>
                    <Section title="Colors">
                        <li><Swatch className="border-2 border-accent bg-node-sel" /> Purple is the box you selected, the lines to what it uses, and what they join. <span className="whitespace-nowrap"><Swatch className="bg-used-by-edge" /> Gold</span> is the lines from what uses it. Everything else fades.</li>
                        <li><Swatch className="outline-2 outline-offset-1 outline-agent" /> Orange is what Claude Code is touching right now.</li>
                        <li><Swatch className="rounded-full bg-ok" /> The cyan dot at the bottom left says the index is up to date.</li>
                        <li><Swatch className="rounded-full bg-danger" /> Red means something failed.</li>
                    </Section>
                    <Section title="The inspector">
                        <li>A short summary, and <b>Full summary</b> for the rest.</li>
                        <li><b>Uses</b>, <b>Used by</b> and <b>Contents</b> are tabs. Click a row to jump to it on the Map.</li>
                        {DEMO
                            ? <li>For a file, <b>View on GitHub</b> opens its code at the indexed commit, and a declaration opens there too.</li>
                            : <li>For a file, <b>View source</b> shows its code, and a declaration jumps to its line there.</li>}
                    </Section>
                    <Section title="Claude Code">
                        {DEMO
                            ? <li>In the app, the status bar along the bottom shows Claude Code&apos;s newest tool call as it works, and the boxes it touched get an orange ring.</li>
                            : (
                                <>
                                    <li>The status bar along the bottom shows Claude Code&apos;s newest tool call as it works.</li>
                                    <li>Boxes holding what it touched get an orange ring for 30 seconds.</li>
                                </>
                            )}
                    </Section>
                    <Section title="The index">
                        <li>The status bar&apos;s first cell says whether the index is up to date. Click it for each stage{DEMO ? "." : ", and to re-index."}</li>
                    </Section>
                </div>

                <h3 className="mt-6 text-[13px] font-medium text-text">Keyboard</h3>
                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px] text-text-2 max-[360px]:grid-cols-1 max-[360px]:[&_dd]:mb-1.5">
                    <dt><Key>Ctrl K</Key></dt><dd>Search files and concepts</dd>
                    <dt><Key>Esc</Key></dt><dd>Close what&apos;s open, let go of the selection, then clear Claude Code&apos;s highlights</dd>
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
            <h3 className="text-[13px] font-medium text-text">{title}</h3>
            <ul className="mt-2 space-y-1.5 text-text-2 [&_b]:font-medium [&_b]:text-text">{children}</ul>
        </section>
    );
}

function Key({ children }: { children: ReactNode }){
    return <kbd className="rounded-md border border-border bg-node px-1.5 py-px font-sans text-[12px] text-text">{children}</kbd>;
}

function Swatch({ className }: { className: string }){
    return <span aria-hidden className={`mr-1 inline-block h-3 w-3 rounded-sm align-[-1px] ${className}`} />;
}
