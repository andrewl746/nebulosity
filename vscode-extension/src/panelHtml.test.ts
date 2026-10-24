import { describe, expect, it } from "vitest";
import { frameOrigin, mapFrameUrl, panelHtml, type PanelState } from "./panelHtml";

const RELAY = "https://file+.vscode-resource.vscode-cdn.net/c%3A/ext/dist/relay.js";
const opts = { nonce: "n1", relayUri: RELAY };

/** The content of the page's CSP meta, read from the raw HTML. */
function cspOf(html: string): string | null {
    const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
    return match === null ? null : match[1];
}

/** How many times `needle` appears in `html`. */
const count = (html: string, needle: string): number => html.split(needle).length - 1;

const EVERY_STATE: PanelState[] = [
    { kind: "starting" },
    { kind: "map", frameUrl: "http://localhost:3125/?embed=vscode" },
    { kind: "notInstalled" },
    { kind: "foreign", port: 3000 },
    { kind: "old" },
    { kind: "mismatch", bridge: 2 },
    { kind: "notIndexed", root: "C:/x" },
    { kind: "stopped" },
    { kind: "failed", message: "Error: listen EADDRINUSE" },
];

describe("panelHtml: the Map's state (V1.8 plan P13)", () => {
    it("frames the Map under a CSP naming its port on both local hosts", () => {
        const html = panelHtml({ kind: "map", frameUrl: "http://localhost:3125/?embed=vscode" }, opts);
        expect(cspOf(html)).toBe("default-src 'none'; frame-src http://localhost:3125 http://127.0.0.1:3125; script-src 'nonce-n1'; style-src 'nonce-n1'");
        expect(count(html, "<iframe")).toBe(1);
        expect(html).toContain('src="http://localhost:3125/?embed=vscode"');
        expect(html).toContain(`<script nonce="n1" src="${RELAY}" data-map-origin="http://localhost:3125">`);
    });

    it("adds the frame's own origin when it is on neither local host (a forwarded port)", () => {
        const html = panelHtml({ kind: "map", frameUrl: "http://127.0.0.2:5000/?embed=vscode" }, opts);
        expect(cspOf(html)).toBe(
            "default-src 'none'; frame-src http://localhost:5000 http://127.0.0.1:5000 http://127.0.0.2:5000; script-src 'nonce-n1'; style-src 'nonce-n1'");
        expect(html).toContain('data-map-origin="http://127.0.0.2:5000"');
    });
});

describe("panelHtml: every state", () => {
    it("loads the relay once, with the nonce, and has no inline handler", () => {
        for (const state of EVERY_STATE){
            const html = panelHtml(state, opts);
            expect({ kind: state.kind, scripts: count(html, "<script") }).toEqual({ kind: state.kind, scripts: 1 });
            expect(html).toContain(`<script nonce="n1" src="${RELAY}"`);
            expect({ kind: state.kind, handler: /\son[a-z]+=/i.test(html) }).toEqual({ kind: state.kind, handler: false });
        }
    });

    it("frames nothing outside the map state", () => {
        for (const state of EVERY_STATE.filter((s) => s.kind !== "map")){
            const html = panelHtml(state, opts);
            expect({ kind: state.kind, csp: cspOf(html) }).toEqual({ kind: state.kind, csp: "default-src 'none'; script-src 'nonce-n1'; style-src 'nonce-n1'" });
            expect({ kind: state.kind, iframes: count(html, "<iframe"), mapOrigin: html.includes("data-map-origin") })
                .toEqual({ kind: state.kind, iframes: 0, mapOrigin: false });
        }
    });
});

describe("panelHtml: the copy (design §4.2, Global Constraints)", () => {
    it("starting", () => {
        expect(panelHtml({ kind: "starting" }, opts)).toContain("Starting the Map…");
    });

    it("not installed: the install line and the README", () => {
        const html = panelHtml({ kind: "notInstalled" }, opts);
        expect(html).toContain("Nebulosity isn't installed");
        expect(html).toContain("npm install -g nebulosity");
        expect(html).toContain('href="https://github.com/andrewl746/Nebulosity#readme"');
    });

    it("an older Nebulosity: update the package", () => {
        expect(panelHtml({ kind: "old" }, opts)).toContain("Update Nebulosity: <code>npm install -g nebulosity</code>");
    });

    it("another bridge: the extension is the older side", () => {
        const html = panelHtml({ kind: "mismatch", bridge: 2 }, opts);
        expect(html).toContain("This Map is newer than this extension: update the Nebulosity extension.");
        expect(html).not.toContain("Update Nebulosity:");
    });

    it("stopped: a Start button", () => {
        const html = panelHtml({ kind: "stopped" }, opts);
        expect(html).toContain("The Map stopped");
        expect(html).toContain('<button data-command="start">Start</button>');
    });

    it("not indexed: the root, and the free index", () => {
        const html = panelHtml({ kind: "notIndexed", root: "C:/x" }, opts);
        expect(html).toContain("C:/x");
        expect(html).toContain('<button data-command="indexRepo">Index this repo (free)</button>');
    });

    it("another app on the port: the setting to change", () => {
        const html = panelHtml({ kind: "foreign", port: 3000 }, opts);
        expect(html).toContain("Port 3000 is in use by another app");
        expect(html).toContain("nebulosity.port");
    });

    it("failed: its message and Show log", () => {
        const html = panelHtml({ kind: "failed", message: "Error: listen EADDRINUSE" }, opts);
        expect(html).toContain("Error: listen EADDRINUSE");
        expect(html).toContain('<button data-command="showLog">Show log</button>');
    });
});

describe("panelHtml: escaping", () => {
    it("escapes every value it puts in the page", () => {
        expect(panelHtml({ kind: "notIndexed", root: "C:/a<b" }, opts)).toContain("C:/a&lt;b");
        expect(panelHtml({ kind: "notIndexed", root: "C:/a<b" }, opts)).not.toContain("C:/a<b");
        expect(panelHtml({ kind: "failed", message: `<b>"x" & 'y'</b>` }, opts)).toContain("&lt;b&gt;&quot;x&quot; &amp; 'y'&lt;/b&gt;");
        expect(panelHtml({ kind: "starting" }, { nonce: "n1", relayUri: 'https://x/relay.js"><b' })).toContain('src="https://x/relay.js&quot;&gt;&lt;b"');
    });
});

describe("mapFrameUrl and frameOrigin", () => {
    it("puts one slash, then ?embed=vscode, after the external URL", () => {
        expect(mapFrameUrl("http://localhost:3125/")).toBe("http://localhost:3125/?embed=vscode");
        expect(mapFrameUrl("http://localhost:41234")).toBe("http://localhost:41234/?embed=vscode");
    });

    it("reads the frame URL's origin", () => {
        expect(frameOrigin("http://localhost:41234/?embed=vscode")).toBe("http://localhost:41234");
    });
});
