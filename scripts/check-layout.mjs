// The Map at every window size (the Workbench layout, app/map/shell.ts): headless Chrome over the DevTools protocol
// opens the running Map at a grid of sizes and screen scales, walks it through its states (the inspector in each of its
// places, menus, dialogs, a line's hover card and its pinned list, Claude Code's activity), and checks that nothing is
// cut off out of reach, nothing covers a control, no text is clipped unreadably, the layout is the one shell.ts gives
// that window, the line's card stays inside the canvas and off the line, and the page never scrolls sideways (down only
// in a window shorter than the layout's least height). Plain Node 24 (its global WebSocket and fetch, and its own
// TypeScript stripping for shell.ts), no dependency.
//
//   npm run check-layout -- http://127.0.0.1:3002 [--shots <dir>] [--all-shots] [--sizes 1440x900,1440x900@1.5,200x260] [--dpr 1,2] [--states top,file] [--embed]
//
// A size is WIDTHxHEIGHT in CSS px, with @ and a device pixel ratio for a high-DPI screen. Browser zoom is the same as a
// smaller window at a higher ratio: 1440 × 900 at 125% zoom is 1152x720@1.25. --dpr runs every size at each ratio given.
// --embed walks the Map as VS Code's panel shows it (`embed=vscode` in every address), over VS Code's own sizes.
// It never touches port 3000 (the owner's Map), and it posts its live events only to the server it was given. The Map
// must be showing the VS Code demo repo: the states are VS Code's own folders and files.
// Each size gets a fresh tab, and the states inside it are reached in-app (pushState + popstate), as the Map's own
// navigation does: many full page loads in one tab used to stall the Map's live channel. Last, two walks resize one tab
// live, the way a window or VS Code's panel is dragged (skipped when --sizes or --states narrows the run, unless --resize
// asks).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = "usage: npm run check-layout -- <base-url> [--shots <dir>] [--all-shots] [--sizes WxH[@dpr],...] [--dpr r,...] [--states name,...] [--resize] [--embed]";
/** Every address ends with `embed=vscode` (--embed): the Map as VS Code's panel shows it, Back button and all. */
let EMBED = false;

/**
 * The Map's own layout rules (app/map/shell.ts, pure), so the check expects of each window exactly what the Map was told
 * to do there. Node strips the file's types itself; while it does, it warns that package.json names no module type,
 * which says nothing about the check, so that one warning is kept out of the output.
 */
const { shellLayout } = await (async () => {
    const emit = process.emitWarning;
    process.emitWarning = () => {};
    try{
        return await import(new URL("../app/map/shell.ts", import.meta.url).href);
    } finally {
        process.emitWarning = emit;
    }
})();

/**
 * The browser's sizes: the normal ones, each at the screen scales Windows offers (125%, 150%, 200%), and browser zoom at
 * 125% and 200% of 1440 × 900; then widths in between, a phone and VS Code's side splits, then short windows (VS Code's
 * bottom panel among them) down to 200 × 200, where the page has to scroll down.
 */
const SIZES = [
    "3840x2160",
    "1920x1080", "1920x1080@1.25", "1920x1080@1.5", "1920x1080@2",
    "1440x900", "1440x900@1.25", "1440x900@1.5", "1440x900@2",
    "1100x800", "1100x800@1.25", "1100x800@1.5", "1100x800@2",
    "1152x720@1.25", "720x450@2",
    "900x700", "768x800", "640x700", "520x700", "440x700", "420x900", "400x800", "390x844",
    "360x640", "320x600", "300x900", "280x600", "240x600", "200x600",
    "1600x300", "1600x250", "1440x400", "900x320", "700x400", "640x260", "400x400", "360x320", "280x260", "200x260", "200x200",
];
/** VS Code's panel (--embed): moved to the editor area, the bottom panel at a few heights, the side splits, dragged small. */
const EMBED_SIZES = [
    "1440x900", "1600x300", "1600x300@1.5", "1600x250", "1440x400", "900x320", "700x400", "640x260",
    "420x900", "300x900", "400x400", "200x260",
];
/** The sizes whose screenshots are saved without --all-shots: the normal sizes and a few narrower ones. */
const SHOT_SIZES = new Set(["1920x1080", "1440x900", "1100x800", "768x800", "390x844", "1600x250", "700x400", "240x600", "200x260"]);

/** A size as given: "1440x900", or "1440x900@1.5" at a device pixel ratio. */
function parseSize(spec){
    const m = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(spec);
    if (!m) fail(`a size is WIDTHxHEIGHT, like 400x260, with @ and a pixel ratio if it isn't 1, like 1440x900@1.5: ${spec}`);
    const dpr = m[3] === undefined ? 1 : Number(m[3]);
    if (!(dpr >= 0.5 && dpr <= 4)) fail(`a pixel ratio is between 0.5 and 4: ${spec}`);
    return { spec, width: Number(m[1]), height: Number(m[2]), dpr };
}

/** The layout shell.ts gives a window (the page's own width, without a scrollbar), with or without a selection. */
const layoutAt = (width, height, selected) => shellLayout({ width, height, embedded: EMBED, selected });

/** The toolbar's … menu has something in it (MapToolbar's menu): short of room, short of height, or holding help. */
const toolbarMenuAt = ({ width, height }) => {
    const shell = layoutAt(width, height, false);
    return shell.toolbarInHeader || shell.canvasWidth < 470 || EMBED || width < 480;
};

const FILE = "src/vs/base/common/event.ts";
const DEEP = "src/vs/workbench/contrib/terminal/browser";
/** A page where 43 lines share the run into one box, utils.ts: the hover card's "and 38 more" and the pinned list's scroll. */
const LINES = "src/vs/base/test/common";
/** Some line's end is on the canvas, where the pointer can reach it (pointAtRun). */
const LINE_SHOWN = `[...document.querySelectorAll(".react-flow__edge path.react-flow__edge-path")].some((p) => {
    const length = p.getTotalLength(), q = p.getPointAtLength(Math.max(0, length - 4)), m = p.getScreenCTM();
    const hit = document.elementFromPoint(q.x * m.a + q.y * m.c + m.e, q.x * m.b + q.y * m.d + m.f);
    return !!hit && !!hit.closest(".react-flow__edge");
})`;
/**
 * The states, in the order one tab walks them. `place` is where the Map goes first; `select` clicks a box; `act` does
 * the rest in the page. `when` says at which sizes a state exists at all (a rail only where the explorer is one); the
 * table shows "-" at the others. `applies`, checked in the page once the place is drawn, does the same for what only the
 * page can tell (whether the breadcrumb folded). The activity state comes late: its tool calls stay in the status bar
 * for the rest of the tab's life.
 */
const STATES = [
    { name: "top", place: "" },
    // a long breadcrumb, a busy folder's note and a page control at once
    { name: "deep", place: DEEP },
    // the middle page of three: both of the page control's arrows are live
    { name: "paged", place: "src/vs/base/common", page: 1 },
    // the pointer on the run the most lines share, its hover card beside it, and that run clicked, the card pinned with
    // every line in a list that scrolls (the owner, 2026-10-29): inside the canvas and off the line at every size
    { name: "line-hover", place: LINES, act: "line-hover", applies: LINE_SHOWN },
    { name: "line-pinned", place: LINES, act: "line-pinned", applies: LINE_SHOWN },
    // the pinned card through a zoom with the wheel somewhere else, which takes it with the spot clicked: still inside
    { name: "line-zoomed", place: LINES, act: "line-zoomed", applies: LINE_SHOWN },
    { name: "busy", place: "src/vs/workbench/contrib" },
    // a file with many declarations, on a paged level, the inspector in each of its places (shell.ts): beside the
    // canvas, under it in a tall window, a drawer over it in a short one, over all of it where the window is narrow too
    { name: "file", place: "src/vs/base/common", select: FILE, when: (size) => layoutAt(size.width, size.height, true).inspector === "beside" },
    { name: "below", place: "src/vs/base/common", select: FILE, when: (size) => layoutAt(size.width, size.height, true).inspector === "below" },
    { name: "drawer", place: "src/vs/base/common", select: FILE, when: (size) => layoutAt(size.width, size.height, true).inspector === "drawer" },
    { name: "cover", place: "src/vs/base/common", select: FILE, when: (size) => layoutAt(size.width, size.height, true).inspector === "cover" },
    // another tab of the inspector, Uses (a file opens on Used by)
    { name: "uses-tab", place: "src/vs/base/common", select: FILE, act: "uses-tab" },
    { name: "folder", place: "src/vs", select: "src/vs/workbench" },
    // where the inspector would cover the canvas, a click only selects: the box's actions beside it (owner review,
    // 2026-10-25); the folder state then asks for its Details
    { name: "actions", place: "src/vs", select: "src/vs/workbench", details: false, when: (size) => layoutAt(size.width, size.height, true).inspector === "cover" },
    // the source root's panel, the one the owner saw cut off in VS Code's panel
    { name: "root", place: "", select: "src" },
    // a summary whose lead holds a 51-character setting name in inline code, wider than the panel at any size
    { name: "long-token", place: "extensions/copilot/src/extension/configuration/vscode-node", select: "extensions/copilot/src/extension/configuration/vscode-node/configurationMigration.ts" },
    { name: "source", place: "src/vs/base/common", select: FILE, act: "source" },
    { name: "search", place: "", act: "search" },
    { name: "help", place: "", act: "help" },
    { name: "repo-menu", place: "", act: "repo-menu" },
    { name: "status-menu", place: "", act: "status-menu" },
    // the explorer's rail opened over the canvas, with a box selected so its row is lit
    { name: "explorer-rail", place: "src/vs", select: "src/vs/workbench", act: "explorer-rail", when: (size) => layoutAt(size.width, size.height, true).explorer === "rail" },
    // the toolbar's … menu, wherever it holds something
    { name: "toolbar-menu", place: "src/vs/base/common", act: "toolbar-menu", when: toolbarMenuAt },
    // the folders folded out of a deep breadcrumb, wherever the trail is too long to show whole
    { name: "breadcrumb-menu", place: DEEP, act: "breadcrumb-menu", applies: `!!document.querySelector('[data-testid="breadcrumb-folded"]')` },
    { name: "activity", place: "src/vs", act: "activity" },
    // a failed jump's banner over a paged level with the inspector open: it must clear the page control and the inspector
    { name: "banner", place: "src/vs/base/common", select: FILE, act: "banner" },
    // the same banner with nothing selected
    { name: "banner-plain", place: "src/vs/base/common", act: "banner" },
];
/** What a state does after reaching its place, as a list (most states do one thing). */
const actsOf = (state) => state.act === undefined ? [] : [state.act].flat();

/** The widths and heights where shell.ts's layout changes: each walk crosses every one, down and back up. */
const THRESHOLDS = [1180, 900, 640, 600, 560, 420, 300];
/** Consecutive repeats dropped: a resize to the size the tab already has does nothing. */
const deduped = (sizes) => sizes.filter((size, i) => i === 0 || size !== sizes[i - 1]);
const across = (dimension) => {
    const down = THRESHOLDS.flatMap((t) => [t, t - 1]);
    const steps = [...down, ...down.toReversed()];
    return dimension === "width" ? steps.map((w) => `${w}x900`) : steps.map((h) => `1440x${h}`);
};
/**
 * One tab resized step by step, the way a window or VS Code's panel is dragged: across every threshold in width at 900
 * tall, then in height at 1440 wide, then from 1440 × 900 down to 200 × 260 and back.
 */
const RESIZE_WALK = deduped([
    "1440x900", ...across("width"), "1440x900", "1440x1200", ...across("height"), "1440x900",
    "1100x800", "900x700", "640x600", "420x420", "300x300", "200x260", "300x300", "420x420", "640x600", "900x700", "1100x800", "1440x900",
]);
/**
 * The walks: a file selected and a popover open, one with the repo list (it never moves out of the header) and one with
 * the toolbar's … menu, which exists only where the toolbar is short of room and is drawn again when the toolbar folds
 * into the header. A popover that went is opened again where its button is, so every step has one to place.
 */
const WALKS = [
    { name: "the repo list", act: "repo-menu", popover: "repo-list", button: "repo-menu" },
    { name: "the toolbar's … menu", act: "toolbar-menu", popover: "toolbar-menu", button: "toolbar-more" },
];

// ─── arguments ───────────────────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv){
    const options = { base: null, shots: null, allShots: false, sizes: null, dprs: null, states: STATES, resize: null };
    for (let i = 0; i < argv.length; i++){
        const arg = argv[i];
        if (arg === "--shots") options.shots = path.resolve(argv[++i] ?? "");
        else if (arg === "--all-shots") options.allShots = true;
        else if (arg === "--resize") options.resize = true;
        else if (arg === "--embed") EMBED = true;
        else if (arg === "--sizes"){
            options.sizes = (argv[++i] ?? "").split(",").filter(Boolean);
            options.resize ??= false;
        } else if (arg === "--dpr"){
            options.dprs = (argv[++i] ?? "").split(",").filter(Boolean).map(Number);
            if (options.dprs.some((r) => !(r >= 0.5 && r <= 4))) fail(`--dpr takes pixel ratios between 0.5 and 4, like 1,1.25,2\n${USAGE}`);
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
    options.sizes ??= EMBED ? EMBED_SIZES : SIZES;
    // an empty list would check nothing and still say "0 failures"
    if (options.sizes.length === 0) fail(`--sizes names no size\n${USAGE}`);
    if (options.dprs !== null && options.dprs.length === 0) fail(`--dpr names no ratio\n${USAGE}`);
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
    let sizes = options.sizes.map(parseSize);
    // --dpr: each size at each ratio (a size that names its own ratio keeps it)
    if (options.dprs !== null){
        sizes = sizes.flatMap((size) => size.spec.includes("@") ? [size]
            : options.dprs.map((dpr) => parseSize(dpr === 1 ? size.spec : `${size.spec}@${dpr}`)));
    }
    options.sizes = sizes.filter((size, i) => sizes.findIndex((s) => s.spec === size.spec) === i);
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

/** The window's size and screen scale, as a tab emulates it (the window is the viewport; nothing of Chrome's own). */
const metrics = (size) => ({ width: size.width, height: size.height, deviceScaleFactor: size.dpr, mobile: false });

/** A tab at one size, with helpers to run code in it. */
async function openTab(cdp, size){
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
    await send("Emulation.setDeviceMetricsOverride", metrics(size));
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
 * Back to a plain Map: Escape closes a dialog, a popover, the explorer's rail, the details over a narrow canvas, the
 * selection, then Claude's highlights, one press each.
 */
async function reset(tab){
    // a pointer left on a line (pointAtRun) moves off the page, so its card goes and no later state finds one
    if (tab.linePointer){
        await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: -1, y: -1, button: "none" });
        tab.linePointer = null;
    }
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
/** A box on the canvas is drawn selected (MapBox's tone). */
const SELECTED = `!!document.querySelector('.react-flow__node [data-tone="selected"]')`;

/**
 * Clicks a box. Where the panel fits beside, under or over part of the canvas, the click opens it. Where it would cover
 * the canvas, the click shows the box's actions, and their Details opens the panel, unless `details` is false (the
 * actions state).
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

/** Clicks a control a person can see: one hidden at this size (display: none) is a failure, not a click. */
const click = (tab, selector, what) => tab.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`no ${what}`)});
    if (el.getClientRects().length === 0) throw new Error(${JSON.stringify(`the ${what} is hidden at this size`)});
    el.click();
    return true;
})()`);
/** Whether a control is there and shown at this size. */
const shown = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && el.getClientRects().length > 0; })()`;

/** Claude Code's three tool calls, the last highlighting three boxes: posted to this server's own live channel. */
const ACTIVITY = [
    { tool: "mcp__nebulosity__describe", paths: [FILE] },
    { tool: "mcp__nebulosity__imports", paths: ["src/vs/workbench/contrib/terminal/browser/terminalInstance.ts", FILE] },
    { tool: "mcp__nebulosity__show_on_map", paths: ["src/vs/base", "src/vs/editor", "src/vs/platform"], action: { type: "highlight_nodes", nodeIds: ["src/vs/base", "src/vs/editor", "src/vs/platform"] } },
];
/** The newest call as the status bar names it (activity.ts's activityLabel), in its cell's title at any size. */
const ACTIVITY_LABEL = "Showing src/vs/base +2 on the map";
/** A focus_node on a path the index doesn't hold: the Map stays put and says why in its banner (for 6 s). */
const MISSING_FOCUS = [{ tool: "mcp__nebulosity__show_on_map", paths: [], action: { type: "focus_node", nodeId: "src/vs/base/common/no-such-folder/missing.ts" } }];

async function postLive(base, events){
    for (const event of events){
        const response = await fetch(`${base}/api/live`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
        if (response.status !== 204) throw new Error(`POST /api/live answered ${response.status}`);
    }
}

/** Picks an item from the toolbar's … menu, where the header has no room for its own button (`what`). */
async function pickFromToolbarMenu(tab, label, what){
    await click(tab, '[data-testid="toolbar-more"]', `toolbar's … button (no ${what} at this size)`);
    await tab.waitFor(`!!document.querySelector('[data-testid="toolbar-menu"]')`, "the toolbar's menu");
    await tab.evaluate(`(() => {
        const item = [...document.querySelectorAll('[data-testid="toolbar-menu"] [role^="menuitem"]')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
        if (!item) throw new Error(${JSON.stringify(`no ${label} in the toolbar's menu`)});
        item.click();
        return true;
    })()`);
}

/**
 * The run the most drawn lines share, the drop into the box most of them end at, just over its arrowhead: every line
 * into a box ends on one point under one head (app/map/routes.ts), so 4 px up each one's drawn path is the same spot.
 * Where that spot is off the canvas (a level opened from its top), the canvas is dragged by an empty bit of it, in
 * steps that stay in the window, to bring the spot to the middle of what the window shows of it; where it still can't
 * be reached, the most-shared spot that can. The pointer then comes onto it
 * as a person's does, a step at a time, and stays there (reset moves it off). `tab.linePointer` keeps the spot, the
 * line's half width there and how many lines end there, for the card's own check (inspectLineCard).
 */
async function pointAtRun(tab){
    const find = `(() => {
        const ends = new Map();
        for (const edge of document.querySelectorAll(".react-flow__edge")){
            const p = edge.querySelector("path.react-flow__edge-path");
            if (!p) continue;
            const target = edge.dataset.id.slice(edge.dataset.id.indexOf("->") + 2);
            const length = p.getTotalLength(), q = p.getPointAtLength(Math.max(0, length - 4)), m = p.getScreenCTM();
            const half = (parseFloat(getComputedStyle(p).strokeWidth) || 1) * m.a / 2;
            const end = ends.get(target) ?? { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f, half: 0, lines: 0 };
            end.half = Math.max(end.half, half);
            end.lines++;
            ends.set(target, end);
        }
        const reached = (p) => { const hit = document.elementFromPoint(p.x, p.y); return !!hit && !!hit.closest(".react-flow__edge"); };
        const sorted = [...ends.values()].sort((a, b) => b.lines - a.lines);
        // the part of the canvas in the window: a short window scrolls the page, and the canvas runs on below it
        const pane = document.querySelector(".react-flow__pane").getBoundingClientRect();
        const seen = { left: Math.max(pane.left, 0), top: Math.max(pane.top, 0), right: Math.min(pane.right, innerWidth), bottom: Math.min(pane.bottom, innerHeight) };
        const middle = { x: (seen.left + seen.right) / 2, y: (seen.top + seen.bottom) / 2 };
        // an empty bit of the canvas near the middle of that, to drag it by
        let grip = null;
        for (let ring = 0; ring < 400 && grip === null; ring += 8){
            for (const [fx, fy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]){
                const x = middle.x + fx * ring, y = middle.y + fy * ring;
                if (x < seen.left || x >= seen.right || y < seen.top || y >= seen.bottom) continue;
                if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")){ grip = { x, y }; break; }
            }
        }
        return { most: sorted[0] ?? null, reachedMost: sorted.length > 0 && reached(sorted[0]), reachable: sorted.find(reached) ?? null, grip, middle, seen };
    })()`;
    const mouse = (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", ...extra });
    let found = await tab.evaluate(find);
    if (found.most === null) throw new Error("no line on the level to point at");
    // a drag a step at a time, each one ending inside what the window shows of the canvas: the window gets no pointer
    // past its own edges, so one long drag out of a short window would never move the view
    for (let drags = 0; drags < 24 && !found.reachedMost && found.grip !== null; drags++){
        const { grip, middle, most, seen } = found;
        const dx = Math.max(seen.left + 2 - grip.x, Math.min(seen.right - 2 - grip.x, middle.x - most.x));
        const dy = Math.max(seen.top + 2 - grip.y, Math.min(seen.bottom - 2 - grip.y, middle.y - most.y));
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        await mouse("mouseMoved", grip.x, grip.y);
        await mouse("mousePressed", grip.x, grip.y, { clickCount: 1 });
        for (let i = 1; i <= 8; i++) await mouse("mouseMoved", grip.x + dx * i / 8, grip.y + dy * i / 8, { buttons: 1 });
        await mouse("mouseReleased", grip.x + dx, grip.y + dy, { clickCount: 1 });
        await tab.evaluate(QUIET);
        found = await tab.evaluate(find);
    }
    const spot = found.reachedMost ? found.most : found.reachable;
    if (spot === null) throw new Error("no line's end the pointer can reach on the canvas");
    for (let i = 1; i <= 8; i++) await mouse("mouseMoved", spot.x - 40 + 40 * i / 8, spot.y - 30 + 30 * i / 8);
    await mouse("mouseMoved", spot.x + 0.5, spot.y);
    tab.linePointer = spot;
    await tab.waitFor(`!!document.querySelector('[data-line-card="hover"]')`, "the line's hover card");
    return spot;
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
        case "uses-tab":
            await click(tab, '[data-panel] [role="tab"][data-tab="uses"]', "Uses tab");
            await tab.waitFor(`document.querySelector('[data-panel] [role="tab"][data-tab="uses"]')?.getAttribute("aria-selected") === "true"`, "the Uses tab selected");
            break;
        case "search":
            // the header's search where it shows, else the toolbar's … menu holds it (a short window under 360 px)
            if (await tab.evaluate(shown('[data-testid="search-button"]'))) await click(tab, '[data-testid="search-button"]', "search button");
            else await pickFromToolbarMenu(tab, "Search files and concepts", "search button");
            await tab.waitFor(`document.activeElement?.getAttribute("aria-label") === "Search"`, "the search field's focus");
            await tab.send("Input.insertText", { text: "terminal" });
            await tab.waitFor(`document.querySelectorAll("[data-hit]").length > 0`, "search results");
            // the code lines take their colors once the highlighter loads
            await tab.waitFor(`![...document.querySelectorAll("[role=dialog] .syntax")].some((s) => s.children.length === 0 && s.textContent.trim() !== "")`, "colored code lines", 5_000).catch(() => {});
            break;
        case "help":
            // the header's ? where it shows, else the toolbar's … menu holds it (VS Code's panel, a narrow window)
            if (await tab.evaluate(shown('[data-testid="help-button"]'))) await click(tab, '[data-testid="help-button"]', "help button");
            else await pickFromToolbarMenu(tab, "How to use the Map", "help button");
            await tab.waitFor(`!!document.querySelector('[data-testid="help"]')`, "the help");
            break;
        case "repo-menu":
            await click(tab, '[data-testid="repo-menu"]', "repo menu button (one repo indexed?)");
            await tab.waitFor(`!!document.querySelector('[data-testid="repo-list"]')`, "the repo list");
            break;
        case "status-menu":
            await click(tab, '[data-testid="status-pill"]', "status pill");
            await tab.waitFor(`!!document.querySelector('[data-testid="status-menu"]')`, "the status menu");
            break;
        case "explorer-rail":
            await click(tab, 'button[aria-label="Open the explorer"]', "explorer's rail button");
            await tab.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Explorer"] [data-explorer-row]')`, "the explorer's list over the canvas");
            break;
        case "toolbar-menu":
            await click(tab, '[data-testid="toolbar-more"]', "toolbar's … button");
            await tab.waitFor(`!!document.querySelector('[data-testid="toolbar-menu"]')`, "the toolbar's menu");
            break;
        case "breadcrumb-menu":
            await click(tab, '[data-testid="breadcrumb-folded"]', "breadcrumb's … button");
            await tab.waitFor(`!!document.querySelector('[data-testid="breadcrumb-menu"]')`, "the folded folders' menu");
            break;
        case "banner":
            await postLive(base, MISSING_FOCUS);
            await tab.waitFor(`!!document.querySelector('main [role="alert"]')`, "the failed jump's banner");
            break;
        case "line-hover":
            await pointAtRun(tab);
            break;
        case "line-pinned":
        case "line-zoomed": {
            const spot = await pointAtRun(tab);
            await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: spot.x + 0.5, y: spot.y, button: "left", clickCount: 1 });
            await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: spot.x + 0.5, y: spot.y, button: "left", clickCount: 1 });
            await tab.waitFor(`!!document.querySelector('[data-line-card="pinned"]')`, "the line's pinned card");
            if (step === "line-pinned") break;
            // the wheel turned three times over the middle of what the window shows of the canvas, zooming in round it, so
            // the spot clicked, and the card with it, moves out toward an edge
            const middle = await tab.evaluate(`(() => {
                const r = document.querySelector(".react-flow__pane").getBoundingClientRect();
                return { x: (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2, y: (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2 };
            })()`);
            await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: middle.x, y: middle.y, button: "none" });
            for (let i = 0; i < 3; i++){
                await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: middle.x, y: middle.y, deltaX: 0, deltaY: -120 });
                await sleep(150);
            }
            // the pointer left the spot, so the card's check leaves out the spot
            tab.linePointer = { ...tab.linePointer, zoomed: true };
            break;
        }
        case "activity":
            await postLive(base, ACTIVITY);
            await tab.waitFor(`[...document.querySelectorAll("[title]")].some((el) => el.title.includes(${JSON.stringify(ACTIVITY_LABEL)}))`, "Claude Code's newest call in the status bar");
            // the pulse (0.9 s) is over and the bar's clock has ticked once: "just now" holds for 5 s
            await sleep(1_300);
            break;
        default:
            break;
    }
}

/** What shows that each step is still on screen. */
const STEP_MARKERS = {
    source: `!!document.querySelector("[data-source-viewer]")`,
    "uses-tab": `document.querySelector('[data-panel] [role="tab"][data-tab="uses"]')?.getAttribute("aria-selected") === "true"`,
    search: `document.querySelectorAll("[data-hit]").length > 0`,
    help: `!!document.querySelector('[data-testid="help"]')`,
    "repo-menu": `!!document.querySelector('[data-testid="repo-list"]')`,
    "status-menu": `!!document.querySelector('[data-testid="status-menu"]')`,
    "explorer-rail": `!!document.querySelector('[role="dialog"][aria-label="Explorer"]')`,
    "toolbar-menu": `!!document.querySelector('[data-testid="toolbar-menu"]')`,
    "breadcrumb-menu": `!!document.querySelector('[data-testid="breadcrumb-menu"]')`,
    banner: `!!document.querySelector('main [role="alert"]')`,
    "line-hover": `!!document.querySelector('[data-line-card="hover"]')`,
    "line-pinned": `!!document.querySelector('[data-line-card="pinned"]')`,
    "line-zoomed": `!!document.querySelector('[data-line-card="pinned"]')`,
    activity: `[...document.querySelectorAll("[title]")].some((el) => el.title.includes(${JSON.stringify(ACTIVITY_LABEL)}))`,
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
 *   (d) the page never scrolls sideways, and scrolls down only in a window shorter than the layout's least height, and
 *       then no further than that height;
 *   (e) no two pieces of visible text sit on each other;
 *   (f) no text sits on a control it isn't part of (a message over the canvas lets clicks through, so (b) can't see it);
 *   (g) the layout is the one shell.ts gives this window: the explorer's form, the inspector's place, the toolbar's and
 *       the status bar's rows, the legend, and the page's least height;
 *   (h) no text is drawn under something else (an overlay that lets clicks through, which (b) and (f) can't see).
 * `shell` is shellLayout for the page's own width and height and whether a box is selected, worked out by the caller.
 * The canvas's boxes, lines and the divider pan with the Map, so they're left out.
 */
function inspectLayout({ shell }){
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
    // seen at all: a screen reader's text (sr-only, clipped to nothing) isn't, and its label is what a person clicks
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.clipPath !== "inset(50%)" && cs.clip !== "rect(0px, 0px, 0px, 0px)";
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
    const controls = elements.filter((el) => el.matches('button, a[href], input, [role="button"], label:has(input)')
        && !el.closest(".react-flow__nodes") && getComputedStyle(el).pointerEvents !== "none" && (!modal || modal.contains(el)));
    const hides = (overflow) => overflow === "hidden" || overflow === "clip";
    for (const el of controls){
        let ancestorFailed = false;
        for (let p = el; p; p = p.parentElement) if (failedA.has(p)){ ancestorFailed = true; break; }
        if (ancestorFailed) continue;
        // scrollIntoView scrolls every box that can scroll, overflow: hidden ones too. React Flow's pane is one (its
        // boxes overflow it), and moving what sits over the canvas with it (a box's actions, the banner) would slide it
        // out from under whatever covers it. A person can't scroll such a box, so its scroll goes back before the test.
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

    // (d): sideways never, at any size (the owner, 2026-10-27); down only below the layout's least height, and no further
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 0.5) failures.push(`(d) the page scrolls sideways: ${de.scrollWidth} px of page in a ${de.clientWidth} px window`);
    if (de.scrollHeight > de.clientHeight + 0.5){
        if (window.innerHeight >= shell.minHeight) failures.push(`(d) the page scrolls down (${de.scrollHeight} px of page) in a window ${window.innerHeight} px tall, though the layout needs only ${shell.minHeight}`);
        else if (de.scrollHeight > shell.minHeight + 0.5) failures.push(`(d) the page scrolls down to ${de.scrollHeight} px, past the layout's least height of ${shell.minHeight}`);
    }

    // (g): the layout is shell.ts's for this window
    const mapShell = document.querySelector('[data-testid="map-shell"]');
    const drawn = document.querySelector(".react-flow__node") !== null;
    if (mapShell === null) failures.push("(g) no map-shell on the page");
    else if (drawn){
        const least = parseFloat(getComputedStyle(mapShell).minHeight) || 0;
        if (Math.abs(least - shell.minHeight) > 0.5) failures.push(`(g) the page keeps ${least} px as its least height, where shell.ts says ${shell.minHeight}`);
        const rail = document.querySelector('button[aria-label="Open the explorer"]');
        const list = document.querySelector('aside[aria-label="Explorer"]');
        const explorer = rail ? "rail" : list ? "full" : "none";
        if (explorer !== shell.explorer) failures.push(`(g) the explorer is ${explorer === "none" ? "gone" : `a ${explorer === "rail" ? "rail" : "full list"}`}, where shell.ts says ${shell.explorer}`);
        const panel = document.querySelector("[data-panel]");
        const placement = panel?.getAttribute("data-placement") ?? null;
        if (panel !== null && placement !== shell.inspector) failures.push(`(g) the inspector is ${placement}, where shell.ts says ${shell.inspector}`);
        const wrapper = panel?.closest("[data-inspector-place]")?.getAttribute("data-inspector-place") ?? null;
        if (panel !== null && wrapper !== placement) failures.push(`(g) the inspector says it's ${placement} but sits in the ${wrapper ?? "no"} place`);
        // beside the canvas it's always there (the folder on screen, with nothing selected); under it or as a drawer,
        // whenever something is selected; over the whole canvas only once Details asks
        if (panel === null && (shell.inspector === "beside" || shell.inspector === "below" || shell.inspector === "drawer")) failures.push(`(g) no inspector, where shell.ts puts it ${shell.inspector}`);
        const toolbarRow = document.querySelector('[data-testid="toolbar"]') !== null;
        if (toolbarRow === shell.toolbarInHeader) failures.push(`(g) the toolbar ${toolbarRow ? "has a row of its own" : "is folded into the header"}, where shell.ts says ${shell.toolbarInHeader ? "folded" : "its own row"}`);
        const bar = document.querySelector('[data-testid="activity-bar"]') !== null;
        if (bar !== (shell.status === "bar")) failures.push(`(g) the status bar is ${bar ? "there" : "gone"}, where shell.ts says ${shell.status}`);
        const legend = document.querySelector('[data-testid="legend"]') !== null;
        if (legend !== shell.legend) failures.push(`(g) the legend is ${legend ? "shown" : "gone"}, where shell.ts says ${shell.legend ? "shown" : "gone"}`);
    }

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

    // (h): text something else is drawn over, so it can't be read (a drawer over the end of the banner's line). Each run
    // is hit-tested at its start, middle and end, with every element taking the pointer for the moment (the banner and
    // the overlays let clicks through, and hit-testing skips them otherwise): what's on top there must be the text's own
    // element, unless it's an open popover or a dialog over the Map, by design. With a dialog open, only its text counts.
    const probe = document.createElement("style");
    probe.textContent = "* { pointer-events: auto !important; }";
    document.head.appendChild(probe);
    try{
        for (const run of runs){
            if (modal && !modal.contains(run.el)) continue;
            // a sliver at the edge of a scroll box (a line scrolled nearly out of it) is the box's business, and a hit
            // test at a fractional point there can round onto whatever is next to the box
            if (run.box.bottom - run.box.top < 4 || run.box.right - run.box.left < 6) continue;
            const y = (run.box.top + run.box.bottom) / 2;
            const points = [["its start", run.box.left + 2], ["its middle", (run.box.left + run.box.right) / 2], ["its end", run.box.right - 2]];
            for (const [where, x] of points){
                if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
                const hit = document.elementFromPoint(x, y);
                if (hit === null || run.el === hit || run.el.contains(hit) || hit.contains(run.el)) continue;
                const cover = hit.closest(COVERS);
                if (cover && !cover.contains(run.el)) continue;
                const key = `h|${describe(run.el)}|${describe(hit)}`;
                if (!reported.has(key)){
                    reported.add(key);
                    failures.push(`(h) the text of ${describe(run.el)} is under ${describe(hit)} at ${where}`);
                }
                break;
            }
        }
    } finally {
        probe.remove();
    }
    return failures;
}

/**
 * Runs inside the page, after inspectLayout, in the line states (serialized with toString, like it). The line's card:
 *   (i) lies 8 px inside the canvas (app/map/narrow.ts's CARD_EDGE), and so clear of the toolbar, the legend and an
 *       inspector beside or under the canvas, none of which is on it;
 *   (i) is clear of what's over the canvas, a drawer, a box's actions, the banner (data-keep-clear);
 *   (i) is off the bit of line pointed at, the spot and the line's half width around it, its tail reaching the line,
 *       wherever the canvas has room for it over or under the pointer (not once the wheel has zoomed, `zoomed`);
 *   (i) names every line that ends there, which share that run; and pinned, lists more than its ten rows by scrolling.
 * `spot` is where pointAtRun left the pointer, with the line's half width there and how many lines end there.
 */
function inspectLineCard(spot){
    const failures = [];
    const card = document.querySelector("[data-line-card]");
    if (card === null) return ["(i) no line card on the canvas"];
    const r = card.getBoundingClientRect();
    const canvas = document.querySelector(".react-flow").getBoundingClientRect();
    const EDGE = 8, TOL = 1;
    const over = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOL && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOL;
    const out = [
        r.left < canvas.left + EDGE - TOL && "left", r.top < canvas.top + EDGE - TOL && "top",
        r.right > canvas.right - EDGE + TOL && "right", r.bottom > canvas.bottom - EDGE + TOL && "bottom",
    ].filter(Boolean);
    if (out.length > 0) failures.push(`(i) the line card isn't 8 px inside the canvas (${out.join(", ")}): ${Math.round(r.left)}, ${Math.round(r.top)} to ${Math.round(r.right)}, ${Math.round(r.bottom)} in ${Math.round(canvas.left)}, ${Math.round(canvas.top)} to ${Math.round(canvas.right)}, ${Math.round(canvas.bottom)}`);
    for (const el of document.querySelectorAll("[data-keep-clear]")){
        const k = el.getBoundingClientRect();
        if (k.width >= 0.5 && k.height >= 0.5 && over(r, k)) failures.push(`(i) the line card is over <${el.tagName.toLowerCase()} ${[...el.attributes].map((a) => a.name).filter((n) => n.startsWith("data-")).join(" ")}>`);
    }
    // the spot is on the drop into a box, which runs up and down, so the card sits beside it where it fits, sliding along
    // the line to fit the canvas as long as its tail keeps 12 px from its corners, and else just over or under the spot
    // (narrow.ts's bubbleRoom), 8 in from the canvas's edges. Where it fits, it keeps off the line there, and beside it,
    // its tail reaches the line's edge, 1 px short of it; only a canvas with no room for it may put it over the spot
    const bit = { left: spot.x - spot.half, right: spot.x + spot.half, top: spot.y - spot.half, bottom: spot.y + spot.half };
    const reach = spot.half + 8;
    const beside = Math.max(spot.x - reach - EDGE - canvas.left, canvas.right - EDGE - spot.x - reach) >= r.width - TOL
        && spot.y - canvas.top >= EDGE + 12 && canvas.bottom - spot.y >= EDGE + 12;
    const room = beside ? canvas.height - 2 * EDGE : Math.max(spot.y - 7 - EDGE - canvas.top, canvas.bottom - EDGE - spot.y - 7);
    const roomy = !spot.zoomed && r.height <= room + TOL;
    if (roomy && over(r, bit)) failures.push(`(i) the line card covers the line where the pointer is, at ${Math.round(spot.x)}, ${Math.round(spot.y)}`);
    const tail = card.querySelector("[data-tail]");
    if (roomy && beside && tail === null) failures.push(`(i) the line card has no tail pointing at its line: the card ${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.width)} by ${Math.round(r.height)}, the spot ${Math.round(spot.x)}, ${Math.round(spot.y)}, the canvas ${Math.round(canvas.left)}, ${Math.round(canvas.top)} to ${Math.round(canvas.right)}, ${Math.round(canvas.bottom)}`);
    if (!spot.zoomed && tail !== null){
        const t = tail.getBoundingClientRect();
        const off = Math.hypot(Math.max(t.left - spot.x, 0, spot.x - t.right), Math.max(t.top - spot.y, 0, spot.y - t.bottom));
        if (off > spot.half + 3) failures.push(`(i) the line card's tail stops ${Math.round(off)} px from the middle of its line, which is ${Math.round(spot.half * 2)} px wide`);
    }
    const named = Number(card.dataset.lines);
    if (named !== spot.lines) failures.push(`(i) the line card names ${named} line${named === 1 ? "" : "s"} where ${spot.lines} end on the run`);
    if (card.dataset.lineCard === "pinned" && named > 10){
        const list = card.querySelector("ul");
        if (list === null || list.scrollHeight <= list.clientHeight + TOL) failures.push(`(i) the pinned card's ${named} lines don't scroll`);
    }
    return failures;
}

// ─── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the Map lays itself out by (useWindowSize): the page's own width, without a scrollbar, the window's height, and whether a box is selected. */
const LAYOUT_INPUT = `({ width: document.documentElement.clientWidth, height: window.innerHeight, selected: ${SELECTED} })`;

/**
 * Inspects the tab as it is: shell.ts's layout for what the page reports, then, in one evaluation with the check that the
 * state is still on screen (nothing can change between the two), the inspection.
 */
async function inspect(tab, state){
    const input = await tab.evaluate(LAYOUT_INPUT);
    const shell = layoutAt(input.width, input.height, input.selected);
    // the line states check their card too, from where the pointer was left
    const line = actsOf(state).some((step) => step.startsWith("line-")) && tab.linePointer ? `(${inspectLineCard.toString()})(${JSON.stringify(tab.linePointer)})` : "[]";
    return tab.evaluate(`(() => {
        if (!(${stateShown(state)})) return ["(setup) the state went away before it was inspected"];
        return [...(${inspectLayout.toString()})(${JSON.stringify({ shell })}), ...${line}];
    })()`);
}

/** Saves the tab as `<name>.png`, and the bottom as `<name>-scrolled.png` where the page scrolls down. */
async function shoot(tab, dir, name){
    const file = name.replaceAll("@", "-at-");
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(dir, `${file}.png`), Buffer.from(data, "base64"));
    const scrolled = await tab.evaluate(`(() => { const se = document.scrollingElement; if (se.scrollWidth <= se.clientWidth && se.scrollHeight <= se.clientHeight) return false; scrollTo(se.scrollWidth, se.scrollHeight); return true; })()`);
    if (!scrolled) return;
    await tab.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    const far = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(dir, `${file}-scrolled.png`), Buffer.from(far.data, "base64"));
    await tab.evaluate(`scrollTo(0, 0); true`);
}

/** Opens the Map in the tab and waits for its fonts, then hides what would make two screenshots differ. */
async function openMap(tab, base, state){
    await tab.send("Page.navigate", { url: `${base}${mapUrl(state.place, state.page ?? 0)}` });
    await tab.waitFor(`document.readyState === "complete" && !!document.querySelector(".react-flow")`, "the Map", 60_000);
    await tab.evaluate(`document.fonts.ready.then(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(SHOT_CSS)}; document.head.appendChild(s); return true; })`);
}

/**
 * After a walk's step: the selection is still drawn selected, and the popover, where it's open, lies inside the window.
 * `open` says whether it is; sideways scroll and errors are the inspection's and the tab's.
 */
const walkCheck = (walk) => `(() => {
    const lines = [];
    if (!(${SELECTED})) lines.push("(walk) the selected box isn't selected any more");
    const pop = document.querySelector('[data-testid=${JSON.stringify(walk.popover)}]');
    if (pop){
        const r = pop.getBoundingClientRect(), de = document.documentElement;
        const out = [r.left < -0.5 && "left", r.top < -0.5 && "top", r.right > de.clientWidth + 0.5 && "right", r.bottom > de.clientHeight + 0.5 && "bottom"].filter(Boolean);
        if (out.length > 0) lines.push(\`(walk) ${walk.name} sticks out of the window (\${out.join(", ")}): \${Math.round(r.left)}, \${Math.round(r.top)} to \${Math.round(r.right)}, \${Math.round(r.bottom)} in \${de.clientWidth} × \${de.clientHeight}\`);
    }
    return { lines, open: !!pop };
})()`;

/**
 * One live-resize walk (RESIZE_WALK): one tab, the file selected and a popover open, resized step by step. Each step is
 * inspected like a state, and the selection must hold and the popover stay in the window. Where the popover went (the
 * toolbar's menu has nothing to hold, or was drawn again in the header), it's opened again if its button is there.
 */
async function resizeWalk(cdp, options, walk, failures){
    const place = "src/vs/base/common";
    const tab = await openTab(cdp, parseSize(RESIZE_WALK[0]));
    const row = [];
    let reopened = 0;
    try{
        await openMap(tab, options.base, { place });
        await goTo(tab, place, 0);
        await selectBox(tab, FILE);
        for (const spec of RESIZE_WALK){
            const size = parseSize(spec);
            let lines;
            let note = "";
            try{
                await tab.send("Emulation.setDeviceMetricsOverride", metrics(size));
                await tab.evaluate(QUIET);
                let check = await tab.evaluate(walkCheck(walk));
                if (!check.open && await tab.evaluate(shown(`[data-testid="${walk.button}"]`))){
                    if (row.length > 0) reopened++;
                    note = row.length > 0 ? " (opened again)" : "";
                    await actStep(tab, walk.act, options.base);
                    await tab.evaluate(QUIET);
                    check = await tab.evaluate(walkCheck(walk));
                } else if (!check.open) note = " (no popover here)";
                if (options.shots && options.allShots) await shoot(tab, options.shots, `walk-${walk.act}-${row.length + 1}-${spec}`);
                const state = { place, select: FILE, act: check.open ? walk.act : undefined };
                lines = [...check.lines, ...await inspect(tab, state)];
            } catch (err){
                lines = [`(setup) ${err instanceof Error ? err.message : String(err)}`];
            }
            for (const error of tab.errors.splice(0)) lines.push(`(js) ${error}`);
            for (const line of lines) failures.push(`walk with ${walk.name}, resized to ${spec} ${line}`);
            row.push(lines.length === 0 ? "ok" : String(lines.length));
            console.log(`walk with ${walk.name}, resized to ${spec}: ${lines.length === 0 ? "ok" : `${lines.length} failure${lines.length === 1 ? "" : "s"}`}${note}`);
        }
    } catch (err){
        failures.push(`walk with ${walk.name} (setup) ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        await tab.close();
    }
    return { row, reopened };
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
    const walks = [];
    let ran = 0;
    const started = Date.now();
    try{
        for (const size of options.sizes){
            const tab = await openTab(cdp, size);
            const row = [];
            try{
                await openMap(tab, options.base, options.states[0]);
                for (const state of options.states){
                    const label = `${size.spec} ${state.name}`;
                    if (state.when && !state.when(size)){
                        row.push("-");
                        continue;
                    }
                    let lines;
                    try{
                        await reset(tab);
                        await goTo(tab, state.place, state.page ?? 0);
                        if (state.applies && !(await tab.evaluate(state.applies))){
                            row.push("-");
                            console.log(`${label}: not at this size`);
                            continue;
                        }
                        if (state.select) await selectBox(tab, state.select, { details: state.details !== false });
                        await act(tab, state, options.base);
                        await tab.evaluate(QUIET);
                        if (options.shots && (options.allShots || SHOT_SIZES.has(size.spec))) await shoot(tab, options.shots, `${state.name}-${size.spec}`);
                        lines = await inspect(tab, state);
                    } catch (err){
                        lines = [`(setup) ${err instanceof Error ? err.message : String(err)}`];
                    }
                    for (const error of tab.errors.splice(0)) lines.push(`(js) ${error}`);
                    for (const line of lines) failures.push(`${label} ${line}`);
                    row.push(lines.length === 0 ? "ok" : String(lines.length));
                    ran++;
                    console.log(`${label}: ${lines.length === 0 ? "ok" : `${lines.length} failure${lines.length === 1 ? "" : "s"}`}`);
                }
            } finally {
                await tab.close();
            }
            table.push([size.spec, row]);
        }
        // a state the page decides on (the breadcrumb folding) that never came about checked nothing, and "0 failures"
        // would say it passed; where shell.ts's rules rule a state out (no explorer in VS Code's panel), that's the rule
        for (const [i, state] of options.states.entries()){
            if (state.applies && table.length > 0 && table.every(([, row]) => row[i] === "-")) failures.push(`${state.name} (setup) the state came about at none of the sizes checked`);
        }
        if (options.resize) for (const walk of WALKS) walks.push([walk, await resizeWalk(cdp, options, walk, failures)]);
    } finally {
        cdp.close();
        await chrome.close();
    }

    console.log("\nFailures:");
    if (failures.length === 0) console.log("  none");
    for (const line of failures) console.log(`  ${line}`);
    const width = Math.max(10, ...table.map(([spec]) => spec.length + 1));
    console.log(`\n${"size".padEnd(width)} ${options.states.map((s) => s.name.padEnd(Math.max(4, s.name.length))).join(" ")}`);
    for (const [spec, row] of table) console.log(`${spec.padEnd(width)} ${row.map((cell, i) => cell.padEnd(Math.max(4, options.states[i].name.length))).join(" ")}`);
    let summary = `${ran} size × state combinations (${table.length} sizes${EMBED ? ", inside VS Code's panel" : ""})`;
    for (const [walk, { row, reopened }] of walks){
        const bad = row.filter((cell) => cell !== "ok").length;
        console.log(`\nlive resize, the file selected and ${walk.name} open: ${row.length} steps, ${bad === 0 ? "all ok" : `${bad} with failures`}${reopened > 0 ? `, the popover opened again ${reopened} ${reopened === 1 ? "time" : "times"} where it had gone` : ""}`);
        summary += `, ${row.length} live-resize steps with ${walk.name}`;
    }
    console.log(`\n${summary}, ${failures.length} failure${failures.length === 1 ? "" : "s"}, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
    process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
});
