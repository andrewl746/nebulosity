import { ReactFlowProvider } from "@xyflow/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MapNode } from "@/lib/contracts";
import BoxActions from "./BoxActions";

/**
 * A selected box's actions in a narrow window, as the server draws them (React Flow's store needs its provider). Each
 * button as its label and its title, in order.
 */
function actionsOf(box: MapNode, inEditor: boolean): [string, string][] {
    const html = renderToStaticMarkup(
        <ReactFlowProvider>
            <BoxActions
                box={box}
                position={{ x: 0, y: 0 }}
                onOpen={() => {}}
                onTurnPage={() => {}}
                onDetails={() => {}}
                onOpenFile={inEditor ? () => {} : undefined}
            />
        </ReactFlowProvider>,
    );
    return [...html.matchAll(/<button[^>]*title="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[2], m[1]]);
}

const FILE: MapNode = { path: "src/vs/editor/editor.main.ts", name: "editor.main.ts", kind: "file", fileCount: 1, summaryStatus: "fresh" };
const FOLDER: MapNode = { path: "src/vs/editor/common", name: "common", kind: "folder", fileCount: 700, summaryStatus: "fresh" };

describe("a selected box's actions in a narrow window", () => {
    it("offer a file Open beside Details inside VS Code's panel, as a folder has, opening it in the editor", () => {
        expect(actionsOf(FILE, true)).toEqual([
            ["Open", "Open in VS Code (or double-click it)"],
            ["Details", "Show its details over the Map"],
        ]);
    });

    it("offer a file only Details in a browser tab, which has no editor to open it in", () => {
        expect(actionsOf(FILE, false)).toEqual([["Details", "Show its details over the Map"]]);
    });

    it("keep a folder's Open, which opens it on the Map, inside the panel and out", () => {
        const folder = [["Open", "Open this folder (or double-click it)"], ["Details", "Show its details over the Map"]];
        expect(actionsOf(FOLDER, true)).toEqual(folder);
        expect(actionsOf(FOLDER, false)).toEqual(folder);
    });
});
