import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HelpDialog from "./HelpDialog";

// The help renders into the page's body through a portal, which the server renderer can't draw, so here it's drawn in
// place, and the body it names is a stand-in (there's no page here)
vi.mock("react-dom", async (actual) => ({ ...(await actual<typeof import("react-dom")>()), createPortal: (children: ReactNode) => children }));

function help(embedded: boolean): string {
    vi.stubGlobal("document", { body: null });
    try {
        return renderToStaticMarkup(<HelpDialog onClose={() => {}} embedded={embedded} />);
    } finally {
        vi.unstubAllGlobals();
    }
}
const FILE_LINE = "<b>double-click</b> a file to open it in the editor, or press <b>Open in VS Code</b> in the inspector";

describe("the help on opening a file (the owner, 2026-10-29: a click only selects it)", () => {
    it("says inside VS Code's panel how a file reaches the editor", () => {
        expect(help(true)).toContain(FILE_LINE);
    });

    it("says nothing of it in a browser tab, where a file has no editor to open in", () => {
        expect(help(false)).not.toContain("a file to open it in the editor");
    });
});
