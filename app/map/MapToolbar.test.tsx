import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { LevelResponse } from "@/lib/contracts";
import type { LineDirection } from "./emphasis";
import MapToolbar from "./MapToolbar";

/**
 * The toolbar as the server draws it, around a level shaped like src/vs: editor uses platform and base, and workbench
 * uses editor and base (the VS Code index's counts).
 */
const LEVEL: LevelResponse = {
    repo: "C:/Users/Andrew/Programming/vscode",
    path: "src/vs",
    breadcrumb: ["", "src", "src/vs"],
    nodes: ["workbench", "platform", "editor", "base"].map((name) => ({ path: `src/vs/${name}`, name, kind: "folder" as const, fileCount: 10, summaryStatus: "fresh" as const })),
    edges: [
        { source: "src/vs/workbench", target: "src/vs/editor", count: 3652 },
        { source: "src/vs/editor", target: "src/vs/platform", count: 1212 },
        { source: "src/vs/editor", target: "src/vs/base", count: 2414 },
        { source: "src/vs/workbench", target: "src/vs/base", count: 20648 },
    ],
    hiddenCount: 0,
    page: 0,
    pageCount: 1,
    indexVersion: 1,
};

type Draw = { canvasWidth?: number; inHeader?: boolean; hasSelection?: boolean; direction?: LineDirection; emptySides?: LineDirection[]; pageCount?: number };

function toolbar({ canvasWidth = 900, inHeader = false, hasSelection = true, direction = "all", emptySides = [], pageCount = 1 }: Draw = {}): string {
    return renderToStaticMarkup(
        <ReactFlowProvider>
            <MapToolbar
                level={{ ...LEVEL, pageCount }}
                strongOnly
                onStrongOnly={() => {}}
                busy={false}
                showAllLines={false}
                onShowAllLines={() => {}}
                onTurnPage={() => {}}
                canvasWidth={canvasWidth}
                inHeader={inHeader}
                narrow={false}
                helpInMenu={false}
                onHelp={() => {}}
                searchInMenu={false}
                onSearch={() => {}}
                hasSelection={hasSelection}
                direction={direction}
                onDirection={() => {}}
                emptySides={emptySides}
            />
        </ReactFlowProvider>,
    );
}

type Radio = { label: string; checked: boolean; disabled: boolean; title: string | null; tabIndex: string | null; markup: string };

/** The side picker's radios in the bar, in order, read from the markup. */
function radios(html: string): Radio[] {
    return [...html.matchAll(/<button([^>]*role="radio"[^>]*)>(.*?)<\/button>/g)].map(([, attrs, inner]) => ({
        label: inner.replace(/<[^>]*>/g, ""),
        checked: /aria-checked="true"/.test(attrs),
        disabled: /\sdisabled=""/.test(attrs),
        title: /title="([^"]*)"/.exec(attrs)?.[1] ?? null,
        tabIndex: /tabindex="([^"]*)"/i.exec(attrs)?.[1] ?? null,
        markup: inner,
    }));
}

const GROUP = 'role="radiogroup"';

describe("the toolbar's All, Uses and Used by (the owner's pick A2, 2026-10-29)", () => {
    it("puts them in the bar right before Strong links only, All picked at first", () => {
        const html = toolbar();
        expect(radios(html).map((r) => [r.label, r.checked, r.disabled])).toEqual([["All", true, false], ["Uses", false, false], ["Used by", false, false]]);
        expect(html.indexOf(GROUP)).toBeGreaterThan(-1);
        expect(html.indexOf(GROUP)).toBeLessThan(html.indexOf("Strong links only"));
        expect(html).toContain('aria-label="Lines of the selected box"');
    });

    it("greys them out with nothing selected, saying why, in the same place, so nothing moves on a click", () => {
        const html = toolbar({ hasSelection: false });
        expect(radios(html).map((r) => r.disabled)).toEqual([true, true, true]);
        expect(html).toContain('title="Select a box to choose which of its lines are highlighted"');
        expect(html.indexOf(GROUP)).toBeLessThan(html.indexOf("Strong links only"));
    });

    it("marks the side picked in its lines' color, Uses in the pale purple and Used by in gold, as the inspector's tabs are", () => {
        const uses = radios(toolbar({ direction: "uses" }));
        expect(uses.map((r) => r.checked)).toEqual([false, true, false]);
        expect(uses[1].markup).toContain("bg-edge-strong");
        expect(uses[1].markup).not.toContain("bg-accent");
        const usedBy = radios(toolbar({ direction: "usedBy" }));
        expect(usedBy.map((r) => r.checked)).toEqual([false, false, true]);
        expect(usedBy[2].markup).toContain("bg-used-by-edge");
        // All has no colour of its own to underline
        expect(radios(toolbar())[0].markup).not.toContain("bg-");
    });

    it("greys out a side with no line on the page, saying why, so no pick colours nothing", () => {
        const sides = radios(toolbar({ emptySides: ["uses"] }));
        expect(sides.map((r) => r.disabled)).toEqual([false, true, false]);
        expect(sides[1].title).toBe("The selected box uses nothing on this page");
        expect(radios(toolbar({ emptySides: ["usedBy"] }))[2].title).toBe("Nothing on this page uses the selected box");
    });

    it("takes the keyboard's Tab only on the side picked, the arrows moving between them", () => {
        expect(radios(toolbar({ direction: "usedBy" })).map((r) => r.tabIndex)).toEqual(["-1", "-1", "0"]);
    });

    it("leaves the bar for the … menu under a 600 px canvas and in a short window", () => {
        expect(toolbar({ canvasWidth: 600 })).toContain(GROUP);
        const narrow = toolbar({ canvasWidth: 599 });
        expect(narrow).not.toContain(GROUP);
        expect(narrow).toContain('data-testid="toolbar-more"');
        expect(toolbar({ canvasWidth: 1600, inHeader: true })).not.toContain(GROUP);
    });

    it("leaves it under 760 px beside a big folder's page control, which left the busy note 16 px in a 700 px panel", () => {
        expect(toolbar({ canvasWidth: 760, pageCount: 3 })).toContain(GROUP);
        expect(toolbar({ canvasWidth: 759, pageCount: 3 })).not.toContain(GROUP);
        expect(toolbar({ canvasWidth: 700, pageCount: 1 })).toContain(GROUP);
    });
});
