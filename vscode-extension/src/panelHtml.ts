/**
 * The panel's page in each of its states (design §4.1–§4.2, V1.8 plan P13). In the `map` state it's a full-size iframe of
 * the running Map; in every other state it's a short message, with a button when there's something to do. Every state
 * loads the same relay script (webview/relay.ts), which carries the editor bridge in the `map` state and relays the
 * buttons' clicks in all of them: the CSP allows no inline script or handler, so a button only carries `data-command`.
 */

/** What the panel shows. `frameUrl` is the Map's address as the webview reaches it (mapFrameUrl). */
export type PanelState =
    | { kind: "starting" }
    | { kind: "map"; frameUrl: string }
    | { kind: "notInstalled" }
    | { kind: "foreign"; port: number }
    | { kind: "old" }
    | { kind: "mismatch"; bridge: number }
    | { kind: "notIndexed"; root: string }
    | { kind: "stopped" }
    | { kind: "failed"; message: string };

const README = "https://github.com/andrewl746/Nebulosity#readme";
const INSTALL = "npm install -g nebulosity";

/** VS Code's theme kinds as the Map names them (lib/contracts.ts's ThemeKind). */
export type FrameKind = "dark" | "light" | "hc" | "hc-light";

/**
 * VS Code's `ColorThemeKind` (Light 1, Dark 2, HighContrast 3, HighContrastLight 4) as the Map's kind. Anything else is
 * dark, the Map's own palette.
 */
export function frameKindOf(colorThemeKind: number): FrameKind {
    return colorThemeKind === 1 ? "light" : colorThemeKind === 3 ? "hc" : colorThemeKind === 4 ? "hc-light" : "dark";
}

/**
 * The address the panel frames: the external URL with one "/" and the flag that turns the Map's bridge on (API_CONTRACTS
 * §20). A theme kind other than dark goes in the address too (`&kind=light`), so a light theme's Map is light from its
 * first paint, before the relay's theme message brings the exact colors (the Workbench redesign, ADR-070).
 */
export function mapFrameUrl(external: string, kind: FrameKind = "dark"): string {
    return `${external.replace(/\/+$/, "")}/?embed=vscode${kind === "dark" ? "" : `&kind=${kind}`}`;
}

/** The frame URL's origin (`http://localhost:41234`): where the relay sends its messages, and the only sender it hears from the frame. */
export function frameOrigin(frameUrl: string): string {
    return new URL(frameUrl).origin;
}

/**
 * Text made safe for HTML, in an element or a double-quoted attribute (every attribute here is double-quoted, so a single
 * quote needs nothing, and the CSP's own quotes stay readable).
 */
function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The webview's CSP (P13). The Map may be framed on its port at either local host name: `<p>` is the frame URL's port,
 * which in a remote is the forwarded one, and the frame URL's own origin is added when it's on neither name. The nonce
 * alone allows the relay (an external script, so no `cspSource` is needed) and the page's one style element. Outside the
 * `map` state nothing may be framed.
 */
function cspOf(state: PanelState, nonce: string): string {
    const parts = ["default-src 'none'"];
    if (state.kind === "map"){
        const url = new URL(state.frameUrl);
        const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
        const pair = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
        const sources = pair.includes(url.origin) ? pair : [...pair, url.origin];
        parts.push(`frame-src ${sources.join(" ")}`);
    }
    parts.push(`script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`);
    return parts.join("; ");
}

/**
 * The message a state shows, as HTML. Every value from outside (a root, a port, a message) is escaped here. The copy is
 * the design's, verbatim where the Global Constraints give it.
 */
function messageOf(state: Exclude<PanelState, { kind: "map" }>): string {
    switch (state.kind){
        case "starting":
            return "<p>Starting the Map…</p>";
        case "notInstalled":
            return [
                "<h1>Nebulosity isn't installed</h1>",
                `<p>Install it with <code>${INSTALL}</code>, then run Show Map again.</p>`,
                `<p><a href="${README}">Read how to set it up</a></p>`,
            ].join("");
        case "foreign":
            return [
                `<h1>Port ${escapeHtml(String(state.port))} is in use by another app</h1>`,
                "<p>The Map can't run there. Set <code>nebulosity.port</code> to a free port, then run Show Map again.</p>",
            ].join("");
        case "old":
            return [
                "<h1>This Map is older than this extension</h1>",
                `<p>Update Nebulosity: <code>${INSTALL}</code>, then start the Map again.</p>`,
            ].join("");
        case "mismatch":
            // a server on another bridge is newer than this extension: the extension is the side to update
            return "<h1>This Map is newer than this extension: update the Nebulosity extension.</h1>";
        case "notIndexed":
            return [
                "<h1>This repo isn't indexed yet</h1>",
                `<p><code>${escapeHtml(state.root)}</code></p>`,
                "<p>Indexing reads the repo's files and imports on this machine, with no API key.</p>",
                '<p><button data-command="indexRepo">Index this repo (free)</button></p>',
            ].join("");
        case "stopped":
            return ["<h1>The Map stopped</h1>", '<p><button data-command="start">Start</button></p>'].join("");
        case "failed":
            return [
                "<h1>The Map couldn't open</h1>",
                `<p class="detail">${escapeHtml(state.message)}</p>`,
                '<p><button data-command="showLog">Show log</button></p>',
            ].join("");
    }
}

/**
 * The person's own theme, as the Map takes it (the Workbench redesign, ADR-070): VS Code's `--vscode-*` variables for
 * the background, the text, code and the scrollbar, each with Dark 2026's value as its fallback, and the Map's purple
 * for the one button a message offers (a step darker on light themes, with white text). So the panel reads as the
 * Map's, in the editor's colors, from its first message to the Map itself, and follows a theme change by itself.
 *
 * It also holds up when the panel is squeezed (the owner's "no matter how much I compress it"). Nothing here is cut off:
 * long words and paths wrap (`overflow-wrap:anywhere` on `main`, whose children inherit it); the side padding shrinks
 * in two steps below 480 px and 240 px wide, so the text keeps its room; below a floor of `main`'s own width
 * (`min-width:7rem` plus its padding) wrapping can't help, so the page scrolls sideways instead; and whatever scrolls
 * does so in the Map's thin scrollbar rather than the browser's default (the same `scrollbar-width` and `scrollbar-color`
 * as app/globals.css). The floor is on `main` and not on `body`, so the `map` state's frame still fills the panel at any
 * size and the Map inside keeps its own floor and scrolling. Wider than 480 px the page is as it was.
 */
const STYLE = [
    "*{scrollbar-width:thin;scrollbar-color:var(--vscode-scrollbarSlider-background,#464747) transparent}",
    "html,body{margin:0;padding:0;height:100%;background:var(--vscode-editor-background,#121314);color:var(--vscode-foreground,#BFBFBF)}",
    "body{font-family:var(--vscode-font-family),system-ui,sans-serif;font-size:13px;line-height:1.5}",
    "iframe{display:block;width:100%;height:100vh;border:0}",
    "main{max-width:34rem;min-width:7rem;padding:2.5rem 2rem;overflow-wrap:anywhere}",
    "@media (max-width:480px){main{padding:1.5rem 1rem}}",
    "@media (max-width:240px){main{padding:1rem .75rem}}",
    "h1{margin:0 0 .75rem;font-size:15px;font-weight:600}",
    "p{margin:0 0 .75rem}",
    "code{padding:.1rem .35rem;border-radius:4px;background:var(--vscode-textCodeBlock-background,#222223);font-family:var(--vscode-editor-font-family),monospace;word-break:break-all}",
    ".detail{color:var(--vscode-descriptionForeground,#8C8C8C);font-family:var(--vscode-editor-font-family),monospace;white-space:pre-wrap;word-break:break-word}",
    "a{color:inherit;text-decoration:underline;text-underline-offset:2px}",
    "button{padding:.375rem .75rem;border:0;border-radius:5px;background:#A855F7;color:#120C1C;font:inherit;font-weight:600;cursor:pointer}",
    "body.vscode-light button,body.vscode-high-contrast-light button{background:#9333EA;color:#FFFFFF}",
    "body.vscode-high-contrast button{outline:1px solid var(--vscode-contrastBorder,#6FC3DF)}",
    ":focus-visible{outline:2px solid var(--vscode-focusBorder,#67E8F9);outline-offset:2px}",
].join("");

/** The panel's whole page for a state. `relayUri` is the webview's URI of dist/relay.js; `nonce` is new for every page. */
export function panelHtml(state: PanelState, opts: { nonce: string; relayUri: string }): string {
    const nonce = escapeHtml(opts.nonce);
    const relay = escapeHtml(opts.relayUri);
    // the relay reads the Map's origin from its own tag; outside the map state it has no frame to talk to
    const body = state.kind === "map"
        ? `<iframe src="${escapeHtml(state.frameUrl)}" title="Nebulosity Map"></iframe>\n<script nonce="${nonce}" src="${relay}" data-map-origin="${escapeHtml(frameOrigin(state.frameUrl))}"></script>`
        : `<main>${messageOf(state)}</main>\n<script nonce="${nonce}" src="${relay}"></script>`;
    return [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(cspOf(state, opts.nonce))}">`,
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>Nebulosity Map</title>",
        `<style nonce="${nonce}">${STYLE}</style>`,
        "</head>",
        "<body>",
        body,
        "</body>",
        "</html>",
    ].join("\n");
}
