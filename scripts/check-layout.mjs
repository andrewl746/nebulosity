// The Map at every window size (docs/VISUAL_REFRESH.md, "Narrow windows"): headless Chrome over the DevTools protocol
// opens the running Map at a grid of sizes, walks it through its states (panels, menus, dialogs, the activity bar),
// and checks that nothing is cut off out of reach, nothing covers a control, no text is clipped unreadably, and the
// page scrolls only below the floor. Plain Node 24 (its global WebSocket and fetch), no dependency.
//
//   npm run check-layout -- http://127.0.0.1:3002 [--shots <dir>] [--all-shots] [--sizes 1440x900,200x260] [--states top,file] [--embed]
//
// --embed walks the Map as VS Code's panel shows it (`embed=vscode` in every address), with its Back button.
// It never touches port 3000 (the owner's Map), and it posts its live events only to the server it was given. The Map
// must be showing the VS Code demo repo: the states are VS Code's own folders and files.
// Each size gets a fresh tab, and the states inside it are reached in-app (pushState + popstate), as the Map's own
// navigation does: many full page loads in one tab used to stall the Map's live channel. A last walk resizes one tab
// live, the way VS Code's panel is dragged (skipped when --sizes or --states narrows the run, unless --resize asks).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = "usage: npm run check-layout -- <base-url> [--shots <dir>] [--all-shots] [--sizes WxH,...] [--states name,...] [--resize] [--embed]";
/** Every address ends with `embed=vscode` (--embed): the Map as VS Code's panel shows it, Back button and all. */
let EMBED = false;

/** Normal sizes, in between, the floor and around it, below it, and short windows; 200 × 260 is the smallest asked for. */
const SIZES = [
    "1440x900", "1100x800",
    "900x700", "768x800", "640x700", "520x700", "440x700", "400x800",
    "360x640", "320x600", "280x600", "240x600", "200x600",
    "1440x400", "900x320", "640x260", "400x400", "360x320", "280x260", "200x260",
];
/** The sizes whose screenshots are saved without --all-shots: both normal sizes (compared before/after) and four narrower ones. */
const SHOT_SIZES = new Set(["1440x900", "1100x800", "768x800", "400x800", "240x600", "200x260"]);
/** At or above this the page must not scroll at all (the Map's look is complete there). */
const NORMAL = { width: 1100, height: 700 };

const FILE = "src/vs/base/common/event.ts";
/**
 * The states, in the order one tab walks them. `place` is where the Map goes first; `select` clicks a box; `act` does
 * the rest in the page. The activity state comes late: its tool calls stay in the bar for the rest of the tab's life.
 */
const STATES = [
    { name: "top", place: "" },
    // a long breadcrumb, a busy folder's note and a page pill at once
    { name: "deep", place: "src/vs/workbench/contrib/terminal/browser" },
    // the middle page of three: both of the pill's arrows are live
    { name: "paged", place: "src/vs/base/common", page: 1 },
    { name: "busy", place: "src/vs/workbench/contrib" },
    // a file with many declarations, on a paged level, so the pill moves aside for the panel
    { name: "file", place: "src/vs/base/common", select: FILE },
    { name: "folder", place: "src/vs", select: "src/vs/workbench" },
    // where the panel would cover the canvas, a click only selects: the box's actions beside it (owner review,
    // 2026-10-25); the folder state then asks for its Details. At the other sizes this is the folder state's panel.
    { name: "actions", place: "src/vs", select: "src/vs/workbench", details: false },
    // the source root's panel, the one the owner saw cut off in VS Code's panel
    { name: "root", place: "", select: "src" },
    // a summary whose lead holds a 51-character setting name in inline code, wider than the panel at any size
    { name: "long-token", place: "extensions/copilot/src/extension/configuration/vscode-node", select: "extensions/copilot/src/extension/configuration/vscode-node/configurationMigration.ts" },
    { name: "source", place: "src/vs/base/common", select: FILE, act: "source" },
    { name: "search", place: "", act: "search" },
    { name: "help", place: "", act: "help" },
    { name: "repo-menu", place: "", act: "repo-menu" },
    { name: "status-menu", place: "", act: "status-menu" },
    // doorways and a busy folder: the legend at its tallest
    { name: "legend", place: "src/vs/base/common", act: "legend" },
    { name: "activity", place: "src/vs", act: "activity" },
    // a failed jump's banner over a paged level with the panel open: it must clear the pill and the panel
    { name: "banner", place: "src/vs/base/common", select: FILE, act: "banner" },
    // the same banner with nothing selected, in the pill's band, and with the legend open, which must leave it room
    { name: "banner-plain", place: "src/vs/base/common", act: "banner" },
    { name: "banner-legend", place: "src/vs/base/common", act: ["legend", "banner"] },
];
/** What a state does after reaching its place, as a list (most states do one thing). */
const actsOf = (state) => state.act === undefined ? [] : [state.act].flat();

/**
 * One tab resized while it shows a file's panel and the open repo list, the way VS Code's panel is dragged: the panel
 * must cover and uncover the canvas, the pill and the zoom controls follow it, and the list stay inside the Map.
 */
const RESIZE_WALK = ["1440x900", "900x700", "760x800", "759x800", "400x400", "360x320", "240x600", "200x260", "640x700", "1100x800", "1440x900"];

// ─── arguments ───────────────────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv){
    const options = { base: null, shots: null, allShots: false, sizes: SIZES, states: STATES, resize: null };
    for (let i = 0; i < argv.length; i++){
        const arg = argv[i];
        if (arg === "--shots") options.shots = path.resolve(argv[++i] ?? "");
        else if (arg === "--all-shots") options.allShots = true;
        else if (arg === "--resize") options.resize = true;
        else if (arg === "--embed") EMBED = true;
        else if (arg === "--sizes"){
            options.sizes = (argv[++i] ?? "").split(",").filter(Boolean);
            options.resize ??= false;
        } else if (arg === "--states"){
            const names = (argv[++i] ?? "").split(",").filter(Boolean);
            const unknown = names.filter((n) => !STATES.some((s) => s.name === n));
            if (unknown.length > 0) fail(`unknown state(s): ${unknown.join(", ")}. Known: ${STATES.map((s) => s.name).join(", ")}`);
            options.states = STATES.filter((s) => names.includes(s.name));
            options.resize ??= false;
        } else if (arg.startsWith("--")) fail(`unknown option ${arg}\n${USAGE}`);
        else options.base = arg;
    }
    if (options.base === null) fail(USAGE);
    // an empty list would check nothing and still say "0 failures"
    if (options.sizes.length === 0) fail(`--sizes names no size\n${USAGE}`);
    if (options.states.length === 0) fail(`--states names no state\n${USAGE}`);
    options.resize ??= true;
    let url;
    try{
        url = new URL(options.base);
    } catch{
        fail(`not a URL: ${options.base}\n${USAGE}`);
    }
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    // the owner's own Map runs on 3000, and this script posts live events to whatever it checks
    if (port === "3000") fail("refusing port 3000: that's where your own Map runs. Start a dev server on another port (npx next dev -p 3002) and check that.");
    options.base = url.origin;
    for (const size of options.sizes) if (!/^\d+x\d+$/.test(size)) fail(`a size is WIDTHxHEIGHT, like 400x260: ${size}`);
    return options;
}

function fail(message){
    console.error(message);
    process.exit(2);
}

// ─── Chrome ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Chrome (or Chromium, or Edge, which speak the same protocol) on Windows, macOS or Linux; CHROME_PATH wins. */
function findChrome(){
    if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
    const onPath = (names) => (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap((dir) => names.map((n) => path.join(dir, n)));
    let candidates;
    if (process.platform === "win32"){
        const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
        candidates = roots.flatMap((root) => [
            path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(root, "Chromium", "Application", "chrome.exe"),
            path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]);
    } else if (process.platform === "darwin"){
        candidates = ["/Applications", path.join(os.homedir(), "Applications")].flatMap((apps) => [
            path.join(apps, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
            path.join(apps, "Chromium.app", "Contents", "MacOS", "Chromium"),
            path.join(apps, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
        ]).concat(onPath(["google-chrome", "chromium"]));
    } else {
        candidates = onPath(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]);
    }
    return candidates.find((c) => existsSync(c)) ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts headless Chrome on a throwaway profile; the DevTools port is whatever was free (DevToolsActivePort says which). */
async function launchChrome(exe){
    const profile = mkdtempSync(path.join(os.tmpdir(), "nebulosity-layout-"));
    const chrome = spawn(exe, [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
        "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1440,900", "about:blank",
    ], { stdio: "ignore" });
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error("Chrome started but never opened its DevTools port");
    let lines = [];
    for (let i = 0; i < 20 && lines.length < 2; i++){
        lines = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
        if (lines.length < 2) await sleep(100);
    }
    const close = async () => {
        chrome.kill();
        await Promise.race([exited, sleep(5_000)]);
        try{
            rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch{
            // Windows may hold a file a moment longer: the profile is in the temp folder either way
        }
    };
    return { url: `ws://127.0.0.1:${lines[0]}${lines[1]}`, close };
}

/** One WebSocket to the browser; each tab is a flattened session on it. */
async function connect(url){
    const ws = new WebSocket(url);
    let next = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener("message", (message) => {
        const msg = JSON.parse(message.data);
        if (msg.id !== undefined){
            const waiting = pending.get(msg.id);
            if (!waiting) return;
            pending.delete(msg.id);
            if (msg.error) waiting.reject(new Error(`${waiting.method}: ${msg.error.message}`));
            else waiting.resolve(msg.result);
        } else for (const listener of listeners) listener(msg);
    });
    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", () => reject(new Error(`couldn't connect to Chrome at ${url}`)), { once: true });
    });
    return {
        send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
            const id = ++next;
            pending.set(id, { resolve, reject, method });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        }),
        listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        close: () => ws.close(),
    };
}

/** A tab at one size, with helpers to run code in it. */
async function openTab(cdp, width, height){
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    const errors = [];
    const stop = cdp.listen((msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === "Runtime.exceptionThrown"){
            const d = msg.params.exceptionDetails;
            errors.push(`uncaught: ${d.exception?.description?.split("\n")[0] ?? d.text}`);
        }
        // React reports its own errors (hydration, keys) through console.error rather than throwing
        if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
            errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 200)}`);
        }
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    // a background tab isn't focused: emulate focus, so the palette's input takes focus the way it does for a person
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    const evaluate = async (expression) => {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(`in the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
        return result.result.value;
    };
    const waitFor = async (expression, what, timeout = 20_000) => {
        const until = Date.now() + timeout;
        while (Date.now() < until){
            if (await evaluate(expression)) return;
            await sleep(100);
        }
        throw new Error(`timed out waiting for ${what}`);
    };
    const close = async () => {
        stop();
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    };
    return { send, evaluate, waitFor, errors, close };
}

// ─── reaching each state ─────────────────────────────────────────────────────────────────────────────────────────────

/** The Map's address for a place (app/map/history.ts's mapUrl, which the browser can't import here). */
function mapUrl(folder, page = 0){
    const params = [
        ...(folder === "" ? [] : [`path=${encodeURIComponent(folder).replaceAll("%2F", "/")}`]),
        ...(page > 0 ? [`page=${page + 1}`] : []),
        ...(EMBED ? ["embed=vscode"] : []),
    ];
    return params.length === 0 ? "/" : `/?${params.join("&")}`;
}

/** Waits until the DOM has been still for 500 ms (at most 8 s), then two frames: whatever was loading has landed. */
const QUIET = `new Promise((resolve) => {
    let timer;
    const done = () => { observer.disconnect(); clearTimeout(cap); requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 500); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(done, 500);
    const cap = setTimeout(done, 8000);
})`;

/** Screenshots compare byte for byte: the dev server's own badge goes, and a blinking caret can't land mid-blink. */
const SHOT_CSS = "nextjs-portal { display: none !important; } * { caret-color: transparent !important; }";

/** Real key presses: they reach the focused field and the document's listeners as a person's do. */
async function press(tab, key, code, keyCode){
    await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
}

/**
 * Back to a plain Map: Escape closes a dialog, a popover, the details over a narrow canvas, the selection, then Claude's
 * highlights, one press each.
 */
async function reset(tab){
    for (let i = 0; i < 5; i++){
        await press(tab, "Escape", "Escape", 27);
        await sleep(60);
    }
    await tab.evaluate(`window.scrollTo(0, 0); document.activeElement?.blur?.(); true`);
}

/** The level of `folder` is drawn: every box belongs to it (a doorway's path is "<folder>//page-2"). */
const atLevel = (folder) => `(() => {
    const params = new URLSearchParams(location.search);
    if ((params.get("path") ?? "") !== ${JSON.stringify(folder)}) return false;
    const boxes = [...document.querySelectorAll(".react-flow__node")];
    if (boxes.length === 0 || document.body.innerText.includes("Loading the map")) return false;
    const folderOf = (id) => id.includes("//") ? id.slice(0, id.indexOf("//")) : id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";
    return boxes.every((b) => folderOf(b.dataset.id) === ${JSON.stringify(folder)});
})()`;

async function goTo(tab, folder, page){
    const target = mapUrl(folder, page);
    const here = await tab.evaluate(`location.pathname + location.search`);
    if (here !== target) await tab.evaluate(`history.pushState(null, "", ${JSON.stringify(target)}); window.dispatchEvent(new PopStateEvent("popstate")); true`);
    // drawn, and the fit a frame later has happened
    await tab.waitFor(atLevel(folder), `the level ${folder || "(top)"}`);
    await tab.evaluate(QUIET);
}

/** The box's panel is up and loaded. */
const panelReady = (box) => `(() => { const p = document.querySelector('[data-panel=${JSON.stringify(box)}]'); return !!p && !p.innerText.includes("Loading…"); })()`;
/** The box's actions beside it, where the panel would cover the canvas (BoxActions). */
const actionsShown = (box) => `!!document.querySelector('[data-box-actions=${JSON.stringify(box)}]')`;

/**
 * Clicks a box. Where the panel fits beside the canvas, the click opens it. Where it would cover the canvas, the click
 * shows the box's actions, and their Details opens the panel, unless `details` is false (the actions state).
 */
async function selectBox(tab, box, { details = true } = {}){
    const found = await tab.evaluate(`(() => {
        const node = document.querySelector('.react-flow__node[data-id=${JSON.stringify(box)}]');
        if (!node) return false;
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
    })()`);
    if (!found) throw new Error(`no box ${box} on the level`);
    await tab.waitFor(`${panelReady(box)} || ${actionsShown(box)}`, `the panel or the actions of ${box}`);
    if (!details || !(await tab.evaluate(actionsShown(box)))) return;
    await tab.evaluate(`(() => {
        const button = [...document.querySelectorAll('[data-box-actions=${JSON.stringify(box)}] button')].find((b) => b.textContent.trim() === "Details");
        if (!button) throw new Error("no Details button");
        button.click();
        return true;
    })()`);
    await tab.waitFor(panelReady(box), `the panel of ${box}`);
}

const click = (tab, selector, what) => tab.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`no ${what}`)});
    el.click();
    return true;
})()`);

/** Claude Code's three tool calls, the last highlighting three boxes: posted to this server's own live channel. */
const ACTIVITY = [
    { tool: "mcp__nebulosity__describe", paths: [FILE] },
    { tool: "mcp__nebulosity__imports", paths: ["src/vs/workbench/contrib/terminal/browser/terminalInstance.ts", FILE] },
    { tool: "mcp__nebulosity__show_on_map", paths: ["src/vs/base", "src/vs/editor", "src/vs/platform"], action: { type: "highlight_nodes", nodeIds: ["src/vs/base", "src/vs/editor", "src/vs/platform"] } },
];
/** A focus_node on a path the index doesn't hold: the Map stays put and says why in its banner (for 6 s). */
const MISSING_FOCUS = [{ tool: "mcp__nebulosity__show_on_map", paths: [], action: { type: "focus_node", nodeId: "src/vs/base/common/no-such-folder/missing.ts" } }];

async function postLive(base, events){
    for (const event of events){
        const response = await fetch(`${base}/api/live`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
        if (response.status !== 204) throw new Error(`POST /api/live answered ${response.status}`);
    }
}

async function act(tab, state, base){
    for (const step of actsOf(state)) await actStep(tab, step, base);
}

async function actStep(tab, step, base){
    switch (step){
        case "source":
            await tab.evaluate(`(() => {
                const button = [...document.querySelectorAll("[data-panel] button")].find((b) => b.textContent.trim() === "View source");
                if (!button) throw new Error("no View source button");
                button.click();
                return true;
            })()`);
            await tab.waitFor(`(() => { const v = document.querySelector("[data-source-viewer] pre.syntax"); return !!v && !!v.querySelector("span"); })()`, "the source, colored");
            break;
        case "search":
            await click(tab, '[data-testid="search-button"]', "search button");
            await tab.waitFor(`document.activeElement?.getAttribute("aria-label") === "Search"`, "the search field's focus");
            await tab.send("Input.insertText", { text: "terminal" });
            await tab.waitFor(`document.querySelectorAll("[data-hit]").length > 0`, "search results");
            // the code lines take their colors once the highlighter loads
            await tab.waitFor(`![...document.querySelectorAll("[role=dialog] .syntax")].some((s) => s.children.length === 0 && s.textContent.trim() !== "")`, "colored code lines", 5_000).catch(() => {});
            break;
        case "help":
            await click(tab, '[data-testid="help-button"]', "help button");
            await tab.waitFor(`!!document.querySelector('[data-testid="help"]')`, "the help");
            break;
        case "repo-menu":
            await click(tab, '[data-testid="repo-menu"]', "repo menu button (one repo indexed?)");
            await tab.waitFor(`!!document.querySelector('[data-testid="repo-menu"]')?.closest(".relative")?.querySelector("ul")`, "the repo list");
            break;
        case "status-menu":
            await click(tab, '[data-testid="status-pill"]', "status pill");
            await tab.waitFor(`!!document.querySelector('[data-testid="status-menu"]')`, "the status menu");
            break;
        case "legend":
            await tab.evaluate(`(() => { const b = document.querySelector('[data-testid="legend-toggle"]'); if (!b) throw new Error("no legend"); if (b.getAttribute("aria-expanded") !== "true") b.click(); return true; })()`);
            break;
        case "banner":
            await postLive(base, MISSING_FOCUS);
            await tab.waitFor(`!!document.querySelector('main [role="alert"]')`, "the failed jump's banner");
            break;
        case "activity":
            await postLive(base, ACTIVITY);
            await tab.waitFor(`document.querySelectorAll('[data-testid="activity-bar"] ol li').length === 3 && document.querySelector('[data-testid="activity-bar"]').innerText.includes("highlighted")`, "three tool calls in the activity bar");
            // the pulse (0.9 s) is over and the bar's clock has ticked once: "just now" holds for 5 s
            await sleep(1_300);
            break;
        default:
            break;
    }
}

/** Undoes what a state left that Escape doesn't: the legend remembers being open. */
async function undo(tab, state){
    if (actsOf(state).includes("legend")) await tab.evaluate(`(() => { const b = document.querySelector('[data-testid="legend-toggle"]'); if (b?.getAttribute("aria-expanded") === "true") b.click(); return true; })()`);
}

/** What shows that each step is still on screen. */
const STEP_MARKERS = {
    source: `!!document.querySelector("[data-source-viewer]")`,
    search: `document.querySelectorAll("[data-hit]").length > 0`,
    help: `!!document.querySelector('[data-testid="help"]')`,
    "repo-menu": `!!document.querySelector('[data-testid="repo-list"]')`,
    "status-menu": `!!document.querySelector('[data-testid="status-menu"]')`,
    legend: `document.querySelector('[data-testid="legend-toggle"]')?.getAttribute("aria-expanded") === "true"`,
    banner: `!!document.querySelector('main [role="alert"]')`,
    activity: `document.querySelectorAll('[data-testid="activity-bar"] ol li').length === 3`,
};

/**
 * True while the state is still on screen: its level, its selection and what it opened. Checked right before the
 * inspection, since some states go by themselves (the banner's 6 s) and a timed-out state must not pass as a plain Map.
 */
const stateShown = (state) => [
    atLevel(state.place),
    ...(state.select ? [state.details === false ? `(${panelReady(state.select)} || ${actionsShown(state.select)})` : panelReady(state.select)] : []),
    ...actsOf(state).map((step) => STEP_MARKERS[step] ?? "true"),
].join(" && ");

// ─── the checks, run in the page ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Runs inside the page (serialized with toString, so it may use nothing from outside). Returns one line per failure:
 *   (a) every visible element lies inside the area its clipping boxes let you scroll to (the document, an overlay, a
 *       panel); a box that only scrolls down must not hold anything sticking out sideways;
 *   (b) every visible control, scrolled into view the way a person can scroll, is the topmost element at its centre
 *       and at the middle of each edge (an open popover may cover what's under it, and a dialog's backdrop covers the
 *       Map by design: then only the dialog's controls count);
 *   (c) text wider than its box is cut by the box, with an ellipsis, a title or aria-label holding the whole text, and
 *       room for a couple of characters, not a lone "…";
 *   (d) at a normal size the page doesn't scroll, and nowhere does it scroll past the floor (the Map root's min size);
 *   (e) no two pieces of visible text sit on each other;
 *   (f) no text sits on a control it isn't part of (a message over the canvas lets clicks through, so (b) can't see it).
 * The canvas's boxes, lines and the divider pan with the Map, so they're left out.
 */
function inspectLayout({ normal }){
    const TOL = 1;
    const failures = [];
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const PANNED = ".react-flow__viewport, .react-flow__edgelabel-renderer, .react-flow__viewport-portal, nextjs-portal";
    // what may lie over the Map by design: dialogs, and what says so with data-covers (an open popover, the alert strip)
    const COVERS = '[role="dialog"], [data-covers]';
    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const describe = (el) => {
        const name = el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.getAttribute("title");
        const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
        const text = norm(el.textContent).slice(0, 48);
        return `<${el.tagName.toLowerCase()}${name ? ` "${norm(name).slice(0, 48)}"` : cls ? ` .${cls}` : ""}>${text ? ` "${text}"` : ""}`;
    };
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) return false;
        return getComputedStyle(el).visibility !== "hidden";
    };
    const elements = [...document.body.querySelectorAll("*")].filter((el) =>
        !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName) && !(el instanceof SVGElement && el.ownerSVGElement) && !el.closest(PANNED) && visible(el));

    // the boxes that clip an element: its ancestors on the containing-block chain with overflow set, and whether it
    // ends fixed to the viewport (an overlay) rather than in the document
    const clipChain = (el) => {
        const chain = [];
        let pos = getComputedStyle(el).position;
        for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement){
            const cs = getComputedStyle(p);
            const holdsFixed = cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" || /paint|layout|strict|content/.test(cs.contain);
            if (pos === "fixed" && !holdsFixed) continue;
            if (pos === "absolute" && cs.position === "static" && !holdsFixed) continue;
            if (cs.overflowX !== "visible" || cs.overflowY !== "visible") chain.push({ box: p, cs });
            pos = cs.position;
        }
        return { chain, fixed: pos === "fixed" };
    };
    const scrolls = (overflow) => overflow === "auto" || overflow === "scroll";

    // (a)
    const failedA = new Set();
    const se = document.scrollingElement;
    for (const el of elements){
        let ancestorFailed = false;
        for (let p = el.parentElement; p; p = p.parentElement) if (failedA.has(p)){ ancestorFailed = true; break; }
        if (ancestorFailed) continue;
        const r = el.getBoundingClientRect();
        const { chain, fixed } = clipChain(el);
        let why = null;
        // past the nearest box that scrolls, nothing else can cut the element off: that box is checked in its own turn
        let reachable = false;
        for (const { box, cs } of chain){
            if (reachable) break;
            // inside a truncated line: whether that line shows enough is (c)'s business
            if (cs.textOverflow === "ellipsis"){ reachable = true; break; }
            const b = box.getBoundingClientRect();
            const left = b.left + box.clientLeft, top = b.top + box.clientTop;
            const xMin = scrolls(cs.overflowX) ? left - box.scrollLeft : left;
            const xMax = scrolls(cs.overflowX) ? xMin + box.scrollWidth : left + box.clientWidth;
            const yMin = scrolls(cs.overflowY) ? top - box.scrollTop : top;
            const yMax = scrolls(cs.overflowY) ? yMin + box.scrollHeight : top + box.clientHeight;
            const out = [
                r.left < xMin - TOL && `left by ${Math.round(xMin - r.left)} px`,
                r.right > xMax + TOL && `right by ${Math.round(r.right - xMax)} px`,
                r.top < yMin - TOL && `top by ${Math.round(yMin - r.top)} px`,
                r.bottom > yMax + TOL && `bottom by ${Math.round(r.bottom - yMax)} px`,
            ].filter(Boolean);
            if (out.length > 0){ why = `is cut off by ${describe(box)} (${out.join(", ")})`; break; }
            // a box that scrolls only down (overflow-y alone makes x "auto" too) shouldn't need a sideways scrollbar
            if (scrolls(cs.overflowX) && !box.hasAttribute("data-scroll-x") && box.scrollWidth > box.clientWidth + TOL && r.right > left + box.clientWidth + TOL){
                why = `needs a sideways scroll inside ${describe(box)} (${Math.round(r.right - left - box.clientWidth)} px)`;
                break;
            }
            reachable = scrolls(cs.overflowX) || scrolls(cs.overflowY);
        }
        if (why || reachable){
            // reported, or reachable by its own scroll box
        } else if (fixed){
            const out = [r.left < -TOL && "left", r.top < -TOL && "top", r.right > vw + TOL && "right", r.bottom > vh + TOL && "bottom"].filter(Boolean);
            if (out.length > 0) why = `is fixed to the window but sticks out of it (${out.join(", ")})`;
        } else {
            const x = r.left + window.scrollX, y = r.top + window.scrollY;
            if (x < -TOL || y < -TOL) why = `sits ${x < -TOL ? `${Math.round(-x)} px left of` : `${Math.round(-y)} px above`} the page, where no scroll reaches`;
            else if (x + r.width > se.scrollWidth + TOL || y + r.height > se.scrollHeight + TOL) why = "sticks out past the page's end";
        }
        if (why){
            failedA.add(el);
            failures.push(`(a) ${describe(el)} ${why}`);
        }
    }

    // (b), after (a): an element already cut off is reported once
    const saved = elements.map((el) => [el, el.scrollLeft, el.scrollTop]);
    const savedWindow = [window.scrollX, window.scrollY];
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const modal = dialogs.at(-1) ?? null;
    const controls = elements.filter((el) => el.matches('button, a[href], input, [role="button"]')
        && !el.closest(".react-flow__nodes") && getComputedStyle(el).pointerEvents !== "none" && (!modal || modal.contains(el)));
    const hides = (overflow) => overflow === "hidden" || overflow === "clip";
    for (const el of controls){
        let ancestorFailed = false;
        for (let p = el; p; p = p.parentElement) if (failedA.has(p)){ ancestorFailed = true; break; }
        if (ancestorFailed) continue;
        // scrollIntoView scrolls every box that can scroll, overflow: hidden ones too. React Flow's pane is one (its
        // boxes overflow it), and moving the zoom controls with it would slide them out from under whatever covers
        // them. A person can't scroll such a box, so its scroll goes back before the hit test.
        const pinned = [];
        for (let p = el.parentElement; p; p = p.parentElement){
            const cs = getComputedStyle(p);
            if (hides(cs.overflowX) || hides(cs.overflowY)) pinned.push([p, hides(cs.overflowX) ? p.scrollLeft : null, hides(cs.overflowY) ? p.scrollTop : null]);
        }
        el.scrollIntoView({ block: "center", inline: "center" });
        for (const [p, left, top] of pinned){
            if (left !== null) p.scrollLeft = left;
            if (top !== null) p.scrollTop = top;
        }
        // the hidden boxes may have done the page's share of the scrolling: the page then brings the control to the
        // middle of the window, as a person scrolling it would (where it scrolls at all: an open dialog locks it)
        if (!pinned.some(([p]) => p === document.documentElement)){
            const s = el.getBoundingClientRect();
            window.scrollBy(s.left + s.width / 2 - vw / 2, s.top + s.height / 2 - vh / 2);
        }
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx >= vw || cy >= vh){
            failures.push(`(b) ${describe(el)} can't be scrolled into view (its centre is at ${Math.round(cx)}, ${Math.round(cy)})`);
            continue;
        }
        // its centre, then the middle of each edge, 2 px in: a control half under something is covered too
        const points = [["its centre", cx, cy]];
        if (r.height > 6) points.push(["its top edge", cx, r.top + 2], ["its bottom edge", cx, r.bottom - 2]);
        if (r.width > 6) points.push(["its left edge", r.left + 2, cy], ["its right edge", r.right - 2, cy]);
        for (const [where, x, y] of points){
            if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit === null || el === hit || el.contains(hit)) continue;
            const cover = hit.closest(COVERS);
            if (cover && !cover.contains(el)) continue;   // an open popover over the Map, by design
            failures.push(`(b) ${describe(el)} is covered by ${describe(hit)} at ${where}`);
            break;
        }
    }
    for (const [el, left, top] of saved){
        if (el.scrollLeft !== left) el.scrollLeft = left;
        if (el.scrollTop !== top) el.scrollTop = top;
    }
    window.scrollTo(savedWindow[0], savedWindow[1]);

    // (c): a box with text of its own, or a truncating box (its text may sit in an inline child)
    for (const el of elements){
        if (el.matches("input, textarea, select")) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "inline" || el.scrollWidth <= el.clientWidth + TOL) continue;
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
        if (!ownText && !(cs.textOverflow === "ellipsis" && norm(el.textContent) !== "")) continue;
        const full = norm(el.textContent).replace(/…/g, "");
        const label = [];
        for (let p = el, i = 0; p && i < 4; p = p.parentElement, i++) label.push(p.getAttribute("title"), p.getAttribute("aria-label"));
        const carried = label.some((t) => t && norm(t).includes(full));
        const over = el.scrollWidth - el.clientWidth;
        // an ellipsis is only drawn where the box cuts its text off; with overflow visible the text runs out of it
        if (cs.overflowX === "visible") failures.push(`(c) ${describe(el)} runs ${over} px out of its box`);
        else if (cs.textOverflow !== "ellipsis") failures.push(`(c) ${describe(el)} is ${over} px wider than its box, with no ellipsis`);
        else if (!carried) failures.push(`(c) ${describe(el)} is cut off with no title or aria-label holding its whole text`);
        // a lone "…" (or a letter and one) says nothing, title or not
        else if (el.clientWidth < 2 * parseFloat(cs.fontSize)) failures.push(`(c) ${describe(el)} is cut to ${el.clientWidth} px, too narrow to read`);
    }

    // (d)
    const root = document.querySelector('[data-testid="map-root"]');
    const floorW = root ? parseFloat(getComputedStyle(root).minWidth) || 0 : 0;
    const floorH = root ? parseFloat(getComputedStyle(root).minHeight) || 0 : 0;
    const sw = se.scrollWidth, sh = se.scrollHeight;
    if (normal && (sw > vw + TOL || sh > vh + TOL)) failures.push(`(d) the page scrolls at a normal size: ${sw} × ${sh} in a ${vw} × ${vh} window`);
    else if (sw > Math.max(vw, floorW) + TOL || sh > Math.max(vh, floorH) + TOL) failures.push(`(d) the page scrolls past the floor: ${sw} × ${sh}, where ${Math.max(vw, floorW)} × ${Math.max(vh, floorH)} is the most it needs`);

    // what of an element shows: the rect its clipping boxes leave (with `self`, its own overflow clips too)
    const clipOf = (el, self) => {
        const { chain, fixed } = clipChain(el);
        const own = getComputedStyle(el);
        if (self && (own.overflowX !== "visible" || own.overflowY !== "visible")) chain.unshift({ box: el, cs: own });
        let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
        for (const { box } of chain){
            const b = box.getBoundingClientRect();
            const left = b.left + box.clientLeft, top = b.top + box.clientTop;
            clip = { left: Math.max(clip.left, left), top: Math.max(clip.top, top), right: Math.min(clip.right, left + box.clientWidth), bottom: Math.min(clip.bottom, top + box.clientHeight) };
        }
        if (fixed) clip = { left: Math.max(clip.left, 0), top: Math.max(clip.top, 0), right: Math.min(clip.right, vw), bottom: Math.min(clip.bottom, vh) };
        return clip;
    };

    // (e): each text run's line boxes, clipped by the boxes that clip it (a truncated line clips its own text too)
    const runs = [];
    for (const el of elements){
        const layer = el.closest(COVERS);
        const clip = clipOf(el, true);
        for (const node of el.childNodes){
            if (node.nodeType !== 3 || node.textContent.trim() === "") continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()){
                const box = { left: Math.max(r.left, clip.left), top: Math.max(r.top, clip.top), right: Math.min(r.right, clip.right), bottom: Math.min(r.bottom, clip.bottom) };
                if (box.right - box.left > 1 && box.bottom - box.top > 1) runs.push({ el, node, layer, box });
            }
        }
    }
    const reported = new Set();
    for (let i = 0; i < runs.length; i++){
        for (let j = i + 1; j < runs.length; j++){
            const a = runs[i], b = runs[j];
            if (a.node === b.node || a.layer !== b.layer) continue;
            const ox = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
            const oy = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
            if (ox <= 2 || oy <= 2) continue;
            const key = `${describe(a.el)}|${describe(b.el)}`;
            if (reported.has(key)) continue;
            reported.add(key);
            failures.push(`(e) ${describe(a.el)} and ${describe(b.el)} overlap (${Math.round(ox)} × ${Math.round(oy)} px)`);
        }
    }

    // (f): text and the controls it isn't part of (its own button, or the button beside it in a line, is fine)
    const controlRects = controls.map((el) => {
        const b = el.getBoundingClientRect(), clip = clipOf(el, false);
        return { el, layer: el.closest(COVERS), r: { left: Math.max(b.left, clip.left), top: Math.max(b.top, clip.top), right: Math.min(b.right, clip.right), bottom: Math.min(b.bottom, clip.bottom) } };
    });
    for (const run of runs){
        for (const { el, layer, r } of controlRects){
            if (run.layer !== layer || el.contains(run.el) || run.el.contains(el)) continue;
            const ox = Math.min(run.box.right, r.right) - Math.max(run.box.left, r.left);
            const oy = Math.min(run.box.bottom, r.bottom) - Math.max(run.box.top, r.top);
            if (ox <= 2 || oy <= 2) continue;
            const key = `f|${describe(run.el)}|${describe(el)}`;
            if (reported.has(key)) continue;
            reported.add(key);
            failures.push(`(f) the text of ${describe(run.el)} sits on ${describe(el)} (${Math.round(ox)} × ${Math.round(oy)} px)`);
        }
    }
    return failures;
}

// ─── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Inspects the tab as it is, in one evaluation with the check that the state is still on screen (nothing can change between the two). */
const inspect = (tab, state, width, height) => tab.evaluate(`(() => {
    if (!(${stateShown(state)})) return ["(setup) the state went away before it was inspected"];
    return (${inspectLayout.toString()})(${JSON.stringify({ normal: width >= NORMAL.width && height >= NORMAL.height })});
})()`);

/** Saves the tab as `<name>.png`, and the far corner as `<name>-scrolled.png` where the page scrolls (below the floor). */
async function shoot(tab, dir, name){
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, "base64"));
    const scrolled = await tab.evaluate(`(() => { const se = document.scrollingElement; if (se.scrollWidth <= innerWidth && se.scrollHeight <= innerHeight) return false; scrollTo(se.scrollWidth, se.scrollHeight); return true; })()`);
    if (!scrolled) return;
    await tab.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    const far = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(dir, `${name}-scrolled.png`), Buffer.from(far.data, "base64"));
    await tab.evaluate(`scrollTo(0, 0); true`);
}

/** Opens the Map in the tab and waits for its fonts, then hides what would make two screenshots differ. */
async function openMap(tab, base, state){
    await tab.send("Page.navigate", { url: `${base}${mapUrl(state.place, state.page ?? 0)}` });
    await tab.waitFor(`document.readyState === "complete" && !!document.querySelector(".react-flow")`, "the Map", 60_000);
    await tab.evaluate(`document.fonts.ready.then(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(SHOT_CSS)}; document.head.appendChild(s); return true; })`);
}

/** The live-resize walk (RESIZE_WALK): one tab, the file's panel and the repo list open, resized step by step. */
async function resizeWalk(cdp, options, failures){
    const state = { name: "resize", place: "src/vs/base/common", select: FILE, act: "repo-menu" };
    const [w0, h0] = RESIZE_WALK[0].split("x").map(Number);
    const tab = await openTab(cdp, w0, h0);
    const row = [];
    try{
        await openMap(tab, options.base, state);
        await goTo(tab, state.place, 0);
        await selectBox(tab, state.select);
        await act(tab, state, options.base);
        for (const size of RESIZE_WALK){
            const [width, height] = size.split("x").map(Number);
            let lines;
            try{
                await tab.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
                await tab.evaluate(QUIET);
                if (options.shots && options.allShots) await shoot(tab, options.shots, `resize-${row.length + 1}-${size}`);
                lines = await inspect(tab, state, width, height);
            } catch (err){
                lines = [`(setup) ${err instanceof Error ? err.message : String(err)}`];
            }
            for (const error of tab.errors.splice(0)) lines.push(`(js) ${error}`);
            for (const line of lines) failures.push(`resize to ${size} ${line}`);
            row.push(lines.length === 0 ? "ok" : String(lines.length));
            console.log(`resize to ${size}: ${lines.length === 0 ? "ok" : `${lines.length} failure${lines.length === 1 ? "" : "s"}`}`);
        }
    } catch (err){
        failures.push(`resize (setup) ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        await tab.close();
    }
    return row;
}

async function main(){
    const options = parseArgs(process.argv.slice(2));
    const exe = findChrome();
    if (exe === null) fail("No Chrome found. Install Google Chrome or Chromium, or set CHROME_PATH to its executable.");
    const status = await fetch(`${options.base}/api/repos`).then((r) => r.json()).catch(() => null);
    if (status === null || !Array.isArray(status.repos)) fail(`No Nebulosity Map answers at ${options.base} (GET /api/repos).`);
    // the states are VS Code's own folders and files: on any other repo every one of them would time out
    const demo = await fetch(`${options.base}/api/level?path=src/vs/base/common`).then((r) => r.ok).catch(() => false);
    if (!demo) fail(`The Map at ${options.base} isn't showing the VS Code repo (no src/vs/base/common), and the check's states are VS Code's folders and files. Index ../vscode and make it the active repo.`);
    if (options.shots) mkdirSync(options.shots, { recursive: true });

    const chrome = await launchChrome(exe);
    const cdp = await connect(chrome.url);
    const failures = [];
    const table = [];
    let resized = null;
    const started = Date.now();
    try{
        // first visit settings, once for the origin: the help doesn't open by itself, and the legend starts closed
        {
            const tab = await openTab(cdp, 800, 600);
            await tab.send("Page.navigate", { url: `${options.base}/api/repos` });
            await tab.waitFor(`document.readyState === "complete"`, "a page on the server's origin");
            await tab.evaluate(`localStorage.setItem("nebulosity.helpSeen", "1"); localStorage.setItem("nebulosity.legendOpen", "0"); true`);
            await tab.close();
        }
        for (const size of options.sizes){
            const [width, height] = size.split("x").map(Number);
            const tab = await openTab(cdp, width, height);
            const row = [];
            try{
                await openMap(tab, options.base, options.states[0]);
                for (const state of options.states){
                    const label = `${size} ${state.name}`;
                    let lines;
                    try{
                        await reset(tab);
                        await goTo(tab, state.place, state.page ?? 0);
                        if (state.select) await selectBox(tab, state.select, { details: state.details !== false });
                        await act(tab, state, options.base);
                        await tab.evaluate(QUIET);
                        if (options.shots && (options.allShots || SHOT_SIZES.has(size))) await shoot(tab, options.shots, `${state.name}-${size}`);
                        lines = await inspect(tab, state, width, height);
                        await undo(tab, state);
                    } catch (err){
                        lines = [`(setup) ${err instanceof Error ? err.message : String(err)}`];
                    }
                    for (const error of tab.errors.splice(0)) lines.push(`(js) ${error}`);
                    for (const line of lines) failures.push(`${label} ${line}`);
                    row.push(lines.length === 0 ? "ok" : String(lines.length));
                    console.log(`${label}: ${lines.length === 0 ? "ok" : `${lines.length} failure${lines.length === 1 ? "" : "s"}`}`);
                }
            } finally {
                await tab.close();
            }
            table.push([size, row]);
        }
        if (options.resize) resized = await resizeWalk(cdp, options, failures);
    } finally {
        cdp.close();
        await chrome.close();
    }

    console.log("\nFailures:");
    if (failures.length === 0) console.log("  none");
    for (const line of failures) console.log(`  ${line}`);
    console.log(`\n${"size".padEnd(10)} ${options.states.map((s) => s.name.padEnd(Math.max(4, s.name.length))).join(" ")}`);
    for (const [size, row] of table) console.log(`${size.padEnd(10)} ${row.map((cell, i) => cell.padEnd(Math.max(4, options.states[i].name.length))).join(" ")}`);
    const combos = table.length * options.states.length;
    let summary = `${combos} size × state combinations`;
    if (resized !== null){
        console.log(`\nlive resize, the file's panel and the repo list open: ${RESIZE_WALK.map((size, i) => `${size} ${resized[i] ?? "-"}`).join(" → ")}`);
        summary += ` and ${RESIZE_WALK.length} live-resize steps`;
    }
    console.log(`\n${summary}, ${failures.length} failure${failures.length === 1 ? "" : "s"}, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
});
