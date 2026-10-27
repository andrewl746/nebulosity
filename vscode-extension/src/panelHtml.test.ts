import { describe, expect, it } from "vitest";
import { frameKindOf, frameOrigin, mapFrameUrl, panelHtml, type PanelState } from "./panelHtml";

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

/** The page's one style element's CSS, read from the raw HTML. */
function styleOf(html: string): string {
    const match = /<style nonce="[^"]*">([^<]*)<\/style>/.exec(html);
    if (match === null) throw new Error("no style element");
    return match[1];
}

describe("panelHtml: narrow widths (the owner's 'no matter how much I compress it', checked in headless Chrome)", () => {
    const longRoot = "C:/Users/Andrew/Programming/some-very-long-repository-name-for-testing/packages/frontend";
    const longMessage = `Error: listen EADDRINUSE\n    at ${"A1b2C3d4E5".repeat(30)}\nsee the log`;

    it("wraps long words and paths anywhere, so nothing runs past the panel", () => {
        const css = styleOf(panelHtml({ kind: "notIndexed", root: longRoot }, opts));
        // on `main`, so the headings, paragraphs, links and buttons inherit it
        expect(css).toMatch(/main\{[^}]*overflow-wrap:anywhere[^}]*\}/);
        // the two long-value elements keep their own break rules
        expect(css).toMatch(/code\{[^}]*word-break:break-all[^}]*\}/);
        expect(css).toMatch(/\.detail\{[^}]*white-space:pre-wrap;word-break:break-word\}/);
        expect(panelHtml({ kind: "failed", message: longMessage }, opts)).toContain('<p class="detail">');
    });

    it("shrinks the side padding in two steps below 480 px and 240 px, and leaves it alone above", () => {
        const css = styleOf(panelHtml({ kind: "stopped" }, opts));
        expect(css).toContain("main{max-width:34rem;min-width:7rem;padding:2.5rem 2rem;");
        expect(css).toContain("@media (max-width:480px){main{padding:1.5rem 1rem}}");
        expect(css).toContain("@media (max-width:240px){main{padding:1rem .75rem}}");
        // every query is a ceiling, so no rule changes the look of a panel wider than 480 px
        const queries = css.match(/@media[^{]*/g) ?? [];
        expect(queries).toEqual(["@media (max-width:480px)", "@media (max-width:240px)"]);
    });

    it("scrolls sideways below a floor on `main`, not on the page, so the Map's frame still fills the panel at any size", () => {
        const css = styleOf(panelHtml({ kind: "map", frameUrl: "http://localhost:3125/?embed=vscode" }, opts));
        expect(css.match(/min-width/g)).toHaveLength(1);
        expect(css).toMatch(/main\{[^}]*min-width:7rem[^}]*\}/);
        expect(css).toContain("iframe{display:block;width:100%;height:100vh;border:0}");
        expect(css).not.toMatch(/overflow\s*:\s*hidden/);
    });

    it("themes whatever scrolls in a thin scrollbar of the theme's own color, with no browser default", () => {
        // the same two properties as app/globals.css, in VS Code's scrollbar color (Dark 2026's box border without one)
        expect(styleOf(panelHtml({ kind: "failed", message: longMessage }, opts)))
            .toContain("*{scrollbar-width:thin;scrollbar-color:var(--vscode-scrollbarSlider-background,#464747) transparent}");
    });

    it("gives every state the same style, so each narrow rule reaches all of them", () => {
        const first = styleOf(panelHtml(EVERY_STATE[0], opts));
        for (const state of EVERY_STATE) expect({ kind: state.kind, css: styleOf(panelHtml(state, opts)) }).toEqual({ kind: state.kind, css: first });
    });
});

describe("panelHtml: the person's theme (ADR-070)", () => {
    it("takes the page's background, text and code from VS Code's variables, with Dark 2026's values to fall back on", () => {
        const css = styleOf(panelHtml({ kind: "stopped" }, opts));
        expect(css).toContain("html,body{margin:0;padding:0;height:100%;background:var(--vscode-editor-background,#121314);color:var(--vscode-foreground,#BFBFBF)}");
        expect(css).toMatch(/code\{[^}]*background:var\(--vscode-textCodeBlock-background,#222223\)/);
        expect(css).toMatch(/\.detail\{[^}]*color:var\(--vscode-descriptionForeground,#8C8C8C\)/);
    });

    it("draws the one button in the Map's purple, a step darker with white text on light themes", () => {
        const css = styleOf(panelHtml({ kind: "stopped" }, opts));
        expect(css).toMatch(/button\{[^}]*background:#A855F7;color:#120C1C/);
        expect(css).toContain("body.vscode-light button,body.vscode-high-contrast-light button{background:#9333EA;color:#FFFFFF}");
        expect(css).toContain(":focus-visible{outline:2px solid var(--vscode-focusBorder,#67E8F9);outline-offset:2px}");
    });
});

describe("mapFrameUrl and frameOrigin", () => {
    it("puts one slash, then ?embed=vscode, after the external URL", () => {
        expect(mapFrameUrl("http://localhost:3125/")).toBe("http://localhost:3125/?embed=vscode");
        expect(mapFrameUrl("http://localhost:41234")).toBe("http://localhost:41234/?embed=vscode");
    });

    it("names a theme kind other than dark, so the Map's first paint is in it", () => {
        expect(mapFrameUrl("http://localhost:3125/", "dark")).toBe("http://localhost:3125/?embed=vscode");
        expect(mapFrameUrl("http://localhost:3125/", "light")).toBe("http://localhost:3125/?embed=vscode&kind=light");
        expect(mapFrameUrl("http://localhost:3125", "hc-light")).toBe("http://localhost:3125/?embed=vscode&kind=hc-light");
    });

    it("reads VS Code's ColorThemeKind (Light 1, Dark 2, HighContrast 3, HighContrastLight 4)", () => {
        expect([1, 2, 3, 4, 0, 5].map(frameKindOf)).toEqual(["light", "dark", "hc", "hc-light", "dark", "dark"]);
    });

    it("reads the frame URL's origin", () => {
        expect(frameOrigin("http://localhost:41234/?embed=vscode")).toBe("http://localhost:41234");
    });
});
