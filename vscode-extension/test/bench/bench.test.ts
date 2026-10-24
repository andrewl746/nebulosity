import assert from "assert";
import * as vscode from "vscode";
import type { ImportsResponse, RepoList } from "../../../lib/contracts";
import { samePath } from "../../src/repoMatch";
import type { NebulosityApi } from "../../src/sync";

/**
 * Editor Benchmark #1 (V1.8 plan Task 10, "The benchmark bars"): the extension against a real Map on VS Code's own repo,
 * timed from the extension host. It runs only with NEB_BENCH=1 (runTest.ts picks this folder then, and the integration
 * tests never load it), with ../vscode as the workspace, which nothing here writes into. VS Code's window has to stay
 * in front: a hidden webview draws nothing and sends no `drawn`.
 * - Cold, no bar: nothing on the port, Show Map → the first `drawn`. The extension starts the Map, which stays up.
 * - E1, Show Map: the panel closed, the Map running and warm, `nebulosity.showMap` executed → the first `drawn` (P1's
 *   on-ready case). Worst of 5 ≤ 2,000 ms.
 * - E2, follow: `showTextDocument(file)` resolved → a `drawn` whose `selected` is that file, the 150 ms debounce
 *   included. 20 files from `/api/imports`' dependents of event.ts (10 in its folder, 10 in other folders), run twice;
 *   the second pass's p95 ≤ 500 ms. The first pass is the cold one, no bar.
 * Every wait starts before its action, since `waitFor` hears only what comes after the call, and a message's time is
 * taken as it arrives (in the wait's predicate), not when the test gets round to it. It prints one JSON line per bar,
 * and a bar that fails fails its test after its line, as bench-mcp exits 1 on a FAIL.
 */

type FromMap = NebulosityApi["received"][number];
type Drawn = Extract<FromMap, { type: "nebulosity.drawn" }>;
/** One timed editor switch: `ms` is the bar's (from resolved), and the level and page the Map drew it on. */
type Switch = { path: string; ms: number; fromCallMs: number; level: string; page: number };

const EXTENSION_ID = "andrewl746.nebulosity-vscode";
const PORT = Number(process.env.NEB_TEST_PORT);
const MAP = `http://127.0.0.1:${PORT}`;

/** E2's files are this file's dependents (the brief), and the first ten sit in its folder: the folder the Map draws. */
const TARGET = "src/vs/base/common/event.ts";
const TARGET_FOLDER = "src/vs/base/common";
const PER_KIND = 10;
/** `/api/imports`' largest page (API_CONTRACTS §19). */
const PAGE = 500;

const E1_RUNS = 5;
const E1_LIMIT_MS = 2_000;
const E2_LIMIT_MS = 500;

/** A cold start may wait out the extension's 60 s start poll, then a first page load on a cold server. */
const COLD_TIMEOUT_MS = 150_000;
/** A warm draw takes well under a second; a first draw of a dense folder in the cold pass, longer. */
const DRAW_TIMEOUT_MS = 30_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const round = (ms: number): number => Math.round(ms * 10) / 10;

/** Nearest-rank percentile of sorted values, as scripts/bench-mcp.ts takes it: of 20, p50 is the 10th, p95 the 19th. */
const percentile = (sorted: number[], q: number): number => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];

function stats(values: number[]): { p50: number; p95: number; max: number } {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), max: round(sorted[sorted.length - 1]) };
}

/** One bar's result, on a line of its own, for BENCHMARKS.md. */
function line(result: Record<string, unknown>): void {
    console.log(JSON.stringify(result));
}

function folder(): vscode.WorkspaceFolder {
    const opened = vscode.workspace.workspaceFolders?.[0];
    assert.ok(opened !== undefined, "VS Code opened no folder (NEB_TEST_WORKSPACE).");
    return opened;
}

const fileUri = (path: string): vscode.Uri => vscode.Uri.joinPath(folder().uri, ...path.split("/"));

/** The panel's tab and its column, read from the tabs; undefined while no panel is open. */
function panelTab(): { tab: vscode.Tab; column: vscode.ViewColumn } | undefined {
    for (const group of vscode.window.tabGroups.all){
        const tab = group.tabs.find((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("nebulosity.map"));
        if (tab !== undefined) return { tab, column: group.viewColumn };
    }
    return undefined;
}

function tabs(): string {
    return vscode.window.tabGroups.all.map((group) => `column ${group.viewColumn}: ${group.tabs.map((tab) => tab.label).join(", ")}`).join("; ");
}

/** Whether the Map's port refuses a connection: nothing listens on it. */
async function refused(): Promise<boolean> {
    try{
        await fetch(`${MAP}/api/repos`, { signal: AbortSignal.timeout(1_000) });
        return false;
    } catch (err){
        return (err as { cause?: { code?: unknown } }).cause?.code === "ECONNREFUSED";
    }
}

async function activeRepo(): Promise<string | null> {
    const response = await fetch(`${MAP}/api/repos`);
    assert.strictEqual(response.status, 200);
    return ((await response.json()) as RepoList).active;
}

/**
 * E2's 20 files, from the target's dependents, transitive, in `/api/imports`' order (nearest first): the first ten in
 * the target's own folder (the level the Map draws for it, so a switch between them stays on it), then the first ten
 * in any other folder. All repo-relative.
 */
async function picks(): Promise<{ inside: string[]; elsewhere: string[]; total: number }> {
    const inside: string[] = [];
    const elsewhere: string[] = [];
    let total = 0;
    for (let offset = 0; inside.length < PER_KIND || elsewhere.length < PER_KIND; offset += PAGE){
        const response = await fetch(`${MAP}/api/imports?path=${encodeURIComponent(TARGET)}&transitive=true&limit=${PAGE}&offset=${offset}`);
        assert.strictEqual(response.status, 200, `GET /api/imports for ${TARGET} answered ${response.status}.`);
        const page = (await response.json()) as ImportsResponse;
        total = page.total;
        for (const file of page.files){
            const parent = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/")));
            const list = parent === TARGET_FOLDER ? inside : elsewhere;
            if (list.length < PER_KIND) list.push(file.path);
        }
        if (page.files.length === 0 || offset + page.files.length >= page.total) break;
    }
    assert.strictEqual(inside.length, PER_KIND, `Only ${inside.length} of ${TARGET}'s dependents sit in ${TARGET_FOLDER}.`);
    assert.strictEqual(elsewhere.length, PER_KIND, `Only ${elsewhere.length} of ${TARGET}'s dependents sit in other folders.`);
    return { inside, elsewhere, total };
}

suite("Editor Benchmark #1: the Map in VS Code on VS Code's repo (E1, E2)", function (){
    this.timeout(600_000);
    let api: NebulosityApi;

    /** A wait that failed says what the bridge carried and where the tabs were. */
    async function expectWait<T>(wait: Promise<T>, what: string): Promise<T> {
        try{
            return await wait;
        } catch (err){
            const tail = (list: unknown[]): string => JSON.stringify(list.slice(-8));
            throw new Error(`${what}: ${messageOf(err)}\n  received (last 8): ${tail(api.received)}\n  sent (last 8): ${tail(api.sent)}\n  tabs: ${tabs()}`);
        }
    }

    /** The first `drawn` from now on that `pred` accepts, with the time it arrived. Start it before the action. */
    function arrival(pred: (m: Drawn) => boolean, timeoutMs: number): Promise<{ drawn: Drawn; at: number }> {
        let at = 0;
        const wait = api.waitFor((m) => {
            if (m.type !== "nebulosity.drawn" || !pred(m)) return false;
            at = performance.now();
            return true;
        }, timeoutMs);
        return wait.then((m) => ({ drawn: m as Drawn, at }));
    }

    /** Show Map, timed from the command's execution to the first `drawn`. */
    async function showMap(timeoutMs: number, what: string): Promise<{ ms: number; drawn: Drawn }> {
        const first = arrival(() => true, timeoutMs);
        const start = performance.now();
        // not awaited first: the command resolves once the panel has its page, before the Map has drawn
        const command = Promise.resolve(vscode.commands.executeCommand("nebulosity.showMap"));
        const { drawn, at } = await expectWait(first, what);
        await command;
        return { ms: at - start, drawn };
    }

    /**
     * Switches the editor to a file, as a pick in the Explorer or Quick Open does (focused, in the active column), and
     * times `showTextDocument` resolved → the Map's `drawn` with that file selected. `fromCallMs` counts from the call.
     */
    async function switchTo(path: string): Promise<Switch> {
        const shown = arrival((m) => m.selected === path, DRAW_TIMEOUT_MS);
        const called = performance.now();
        await vscode.window.showTextDocument(fileUri(path));
        const resolved = performance.now();
        const { drawn, at } = await expectWait(shown, `The Map didn't draw ${path} selected`);
        return { path, ms: round(at - resolved), fromCallMs: round(at - called), level: drawn.path, page: drawn.page };
    }

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<NebulosityApi | undefined>(EXTENSION_ID);
        assert.ok(extension !== undefined, `${EXTENSION_ID} isn't loaded.`);
        const exported = await extension.activate();
        assert.ok(exported !== undefined, "activate returned no NebulosityApi: the extension isn't running in ExtensionMode.Test.");
        api = exported;
        console.log(`The workspace: ${folder().uri.fsPath}.`);
    });

    suiteTeardown(async () => {
        // for the record: the built-in extensions stay on (--disable-extensions leaves them), as in a user's window
        const builtIn = ["vscode.typescript-language-features", "vscode.git"].map((id) => `${id} ${vscode.extensions.getExtension(id)?.isActive === true ? "active" : "not active"}`);
        console.log(`Built-in extensions at the end: ${builtIn.join(", ")}.`);
        // the Map this run started; VS Code's exit would stop it too (deactivate)
        await vscode.commands.executeCommand("nebulosity.stopMap");
    });

    test("cold, no bar: nothing on the port, Show Map → the first drawn", async () => {
        assert.ok(await refused(), `Something answers on port ${PORT}: the cold run needs a free port.`);
        const { ms, drawn } = await showMap(COLD_TIMEOUT_MS, "No drawn after Show Map started the Map");
        // the scratch index's active repo is the workspace's, so the repo step switched nothing
        const active = await activeRepo();
        assert.ok(active !== null && samePath(active, folder().uri.fsPath, process.platform), `The Map's active repo is ${active}, not ${folder().uri.fsPath}.`);
        line({ bench: "cold", bar: null, showMapToDrawnMs: round(ms), drawn });
    });

    test(`E1: Show Map with the Map warm → the first drawn, worst of ${E1_RUNS} ≤ ${E1_LIMIT_MS} ms`, async () => {
        const runs: { ms: number; column: number | undefined; drawn: Drawn }[] = [];
        for (let i = 0; i < E1_RUNS; i++){
            api.closePanel();
            // the closed panel's tab and its emptied column go before the next Show Map
            await delay(1_000);
            assert.strictEqual(panelTab(), undefined, `The panel is still open: ${tabs()}`);
            const { ms, drawn } = await showMap(DRAW_TIMEOUT_MS, `No drawn after Show Map, run ${i + 1}`);
            runs.push({ ms: round(ms), column: panelTab()?.column, drawn });
        }
        const worst = Math.max(...runs.map((r) => r.ms));
        const pass = worst <= E1_LIMIT_MS;
        line({ bench: "E1", bar: `worst of ${E1_RUNS} <= ${E1_LIMIT_MS} ms`, runsMs: runs.map((r) => r.ms), worstMs: worst, pass, runs });
        assert.ok(pass, `E1 FAIL: the worst Show Map took ${worst} ms.`);
    });

    test(`E2: an editor switch → the Map showing that file selected, p95 of 20 ≤ ${E2_LIMIT_MS} ms (the second pass)`, async () => {
        const { inside, elsewhere, total } = await picks();
        console.log(JSON.stringify({ bench: "E2 files", target: TARGET, dependents: total, inside, elsewhere }));
        // each switch also says whether the Map drew another level or page for it, or only moved the selection
        const passes: (Switch & { newLevel: boolean })[][] = [];
        for (let pass = 1; pass <= 2; pass++){
            // the lead-in, not counted: the Map goes to the target's folder, so the ten switches inside it stay there
            let before = await switchTo(TARGET);
            const switches: (Switch & { newLevel: boolean })[] = [];
            for (const path of [...inside, ...elsewhere]){
                const done = await switchTo(path);
                switches.push({ ...done, newLevel: done.level !== before.level || done.page !== before.page });
                before = done;
            }
            passes.push(switches);
        }
        const [cold, warm] = passes;
        const kinds = (switches: Switch[]): Record<string, unknown> => ({
            inside: stats(switches.slice(0, PER_KIND).map((s) => s.ms)),
            elsewhere: stats(switches.slice(PER_KIND).map((s) => s.ms)),
        });
        line({ bench: "E2 cold (the first pass)", bar: null, ...stats(cold.map((s) => s.ms)), byKind: kinds(cold), switches: cold });
        const measured = stats(warm.map((s) => s.ms));
        const pass = measured.p95 <= E2_LIMIT_MS;
        line({ bench: "E2", bar: `p95 of 20 <= ${E2_LIMIT_MS} ms, the second pass`, ...measured, pass, byKind: kinds(warm), switches: warm });
        assert.ok(pass, `E2 FAIL: p95 ${measured.p95} ms.`);
    });
});
