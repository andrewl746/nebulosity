"use client";

/**
 * What the Map's marks mean, in a sentence under the canvas (the Workbench redesign, ADR-070). It replaces both the
 * legend card in the canvas's corner and the help that opened by itself on a first visit: the full help stays behind
 * the ? button and key. The doorways, Claude Code's rings and a busy folder's hidden lines get a sentence of their own
 * only where they appear. In a short window or over a narrow canvas it goes (shell.ts), the help still having it.
 */
export default function Legend({ doorways, agent, quiet }: {
    /** The level has doorways to its other pages. */
    doorways: boolean;
    /** Claude Code is touching boxes on screen. */
    agent: boolean;
    /** A busy level, whose lines show on hover. */
    quiet: boolean;
}){
    return (
        <p data-testid="legend" className="shrink-0 border-t border-divider px-3.5 py-2.5 text-[12px] leading-[1.45] text-text-3">
            Dot size shows how many files a folder has. Line weight, and the number on a line, show how many imports it carries. Arrows point at the code being used.
            Folders are stacked cards, and a page marks a single file.
            {doorways && " A dashed box is a doorway to another page of this folder."}
            {agent && " An orange ring is what Claude Code is touching right now."}
            {quiet && " In a busy folder, hover a box to see its lines."}
        </p>
    );
}
