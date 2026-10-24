import assert from "assert";
import fs from "fs";
import { isDeepStrictEqual } from "util";
import * as vscode from "vscode";
import type { RepoList } from "../../../lib/contracts";
import { findOnPath } from "../../src/command";
import { samePath } from "../../src/repoMatch";
import type { NebulosityApi } from "../../src/sync";

/**
 * The extension against a real Map (V1.8 plan Task 9), on a copy of test/fixtures/mini-repo indexed with --no-activate,
 * so Show Map's repo step has to switch the Map to it. The tests run in order and each starts where the one before
 * left the editor and the Map. Every wait for a message starts before the action it waits on, since `waitFor` and
 * `waitForSent` hear only what comes after the call. Files open where a user's would (the active column, or where the
 * extension puts a file picked on the Map), and the panel has to stay visible on its own: a hidden webview draws
 * nothing and sends no `drawn`.
 * The expected values are the plan's ground truth for the fixture ("## Ground truth for this slice").
 */

type FromMap = NebulosityApi["received"][number];
type ToMap = NebulosityApi["sent"][number];
type Drawn = Extract<FromMap, { type: "nebulosity.drawn" }>;
type Highlight = Extract<ToMap, { type: "nebulosity.highlight" }>;

const EXTENSION_ID = "andrewl746.nebulosity-vscode";
/** This run's own Map (runTest.ts refuses 3000), so the live event of test 10 reaches no one else's. */
const PORT = Number(process.env.NEB_TEST_PORT);
const MAP = `http://127.0.0.1:${PORT}`;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A `drawn`, or with `selected` one whose selected box is that file. */
function drawnOf(selected?: string): (m: FromMap) => boolean {
    return (m) => m.type === "nebulosity.drawn" && (selected === undefined || m.selected === selected);
}

const isFollowOf = (path: string) => (m: ToMap): boolean => m.type === "nebulosity.follow" && m.path === path;

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

/** Opens a file as switching to it does: focused, in the active column, where VS Code opens a file the user picks. */
const openFile = (path: string): Thenable<vscode.TextEditor> => vscode.window.showTextDocument(fileUri(path));

function assertActive(path: string): void {
    const active = vscode.window.activeTextEditor?.document.uri;
    assert.ok(active !== undefined && samePath(active.fsPath, fileUri(path).fsPath, process.platform), `The active editor is ${active?.fsPath ?? "none"}, not ${path}.`);
}

/** Every tab, by group: what a failure message shows, since a panel hidden behind an editor sends no `drawn`. */
function tabs(): string {
    return vscode.window.tabGroups.all.map((group) => `column ${group.viewColumn}: ${group.tabs.map((tab) => tab.label).join(", ")}`).join("; ");
}

async function activeRepo(): Promise<string | null> {
    const response = await fetch(`${MAP}/api/repos`);
    assert.strictEqual(response.status, 200);
    return ((await response.json()) as RepoList).active;
}

/** Whether the Map's port refuses a connection: nothing listens on it any more. */
async function refused(): Promise<boolean> {
    try{
        await fetch(`${MAP}/api/repos`, { signal: AbortSignal.timeout(1_000) });
        return false;
    } catch (err){
        return (err as { cause?: { code?: unknown } }).cause?.code === "ECONNREFUSED";
    }
}

suite("The extension against a real Map, on the mini-repo", () => {
    let api: NebulosityApi;

    /** A wait that failed says what the bridge carried and where the tabs were, so a CI log alone can explain it. */
    async function expectWait<T>(wait: Promise<T>, what: string): Promise<T> {
        try{
            return await wait;
        } catch (err){
            const tail = (list: unknown[]): string => JSON.stringify(list.slice(-8));
            throw new Error(`${what}: ${messageOf(err)}\n  received (last 8): ${tail(api.received)}\n  sent (last 8): ${tail(api.sent)}\n  panel's port: ${api.port()}\n  tabs: ${tabs()}`);
        }
    }

    /**
     * Closes the quick pick until `done` settles: a close that reached the workbench before the pick did would close
     * nothing, and the pick would stay open for the rest of the run.
     */
    async function closeQuickOpenUntil(done: Promise<unknown>): Promise<void> {
        let settled = false;
        const end = done.then(() => { settled = true; }, () => { settled = true; });
        while (!settled){
            await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
            await Promise.race([end, delay(500)]);
        }
    }

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<NebulosityApi | undefined>(EXTENSION_ID);
        assert.ok(extension !== undefined, `${EXTENSION_ID} isn't loaded.`);
        const exported = await extension.activate();
        assert.ok(exported !== undefined, "activate returned no NebulosityApi: the extension isn't running in ExtensionMode.Test.");
        api = exported;
        // what the extension will run, for a CI log: the setting, else `nebulosity` on the extension host's PATH
        const setting = vscode.workspace.getConfiguration("nebulosity").get<string>("command") ?? "";
        const onPath = findOnPath("nebulosity", process.env, process.platform, fs.existsSync);
        console.log(`The workspace: ${folder().uri.fsPath}. nebulosity.command: "${setting}". nebulosity on PATH: ${onPath ?? "none"}.`);
        // VS Code may take a login shell's PATH on macOS and Linux, which a CI step's PATH entries don't reach
        if (setting.trim() === "") console.log(`The extension host's PATH: ${process.env.PATH ?? ""}`);
    });

    test("Show Map starts the Map and draws it", async () => {
        const drawn = api.waitFor(drawnOf(), 90_000);
        await vscode.commands.executeCommand("nebulosity.showMap");
        // the frame loaded and the Map answered the handshake: the drawn after ready (P1's on-ready case), at the top level
        const first = (await expectWait(drawn, "No drawn after Show Map")) as Drawn;
        assert.strictEqual(first.path, "");
        assert.strictEqual(first.page, 0);
        assert.ok(api.received.some((m) => isDeepStrictEqual(m, { type: "nebulosity.ready", version: 1 })), `No ready: ${JSON.stringify(api.received)}`);
        assert.strictEqual(api.port(), PORT);
        // the repo step switched the Map to the copy: VS Code's spelling of the folder (d:\… on Windows) against the index's (D:/…)
        const active = await activeRepo();
        assert.ok(active !== null && samePath(active, folder().uri.fsPath, process.platform), `The Map's active repo is ${active}, not ${folder().uri.fsPath}.`);
    });

    test("with nothing open, a file picked on the Map opens beside the panel, which stays in view", async () => {
        // no text editor was visible, so the panel took column 2 and left column 1 for the code (Task 9 review, ruling 4)
        const before = panelTab();
        assert.strictEqual(before?.column, vscode.ViewColumn.Two, `The panel isn't in column 2: ${tabs()}`);
        await api.simulateFromMap({ type: "nebulosity.open", path: "src/index.ts" });
        const opened = vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, fileUri("src/index.ts").fsPath, process.platform));
        assert.ok(opened !== undefined, `src/index.ts isn't open: ${tabs()}`);
        const after = panelTab();
        assert.ok(after !== undefined && opened.viewColumn !== after.column, `The file opened in the panel's column: ${tabs()}`);
        assert.ok(after.tab.isActive, `The panel is hidden behind another tab: ${tabs()}`);
    });

    test("the Map follows the editor", async () => {
        const drawn = api.waitFor(drawnOf("src/core/log.ts"), 10_000);
        await openFile("src/core/log.ts");
        const shown = (await expectWait(drawn, "The Map didn't draw src/core/log.ts selected")) as Drawn;
        assert.strictEqual(shown.path, "src/core");
        assert.deepStrictEqual(api.sent[api.sent.length - 1], { type: "nebulosity.follow", path: "src/core/log.ts" });
    });

    test("a pick on the Map opens the file and doesn't echo, and a switch back follows", async () => {
        const from = api.sent.length;
        await api.simulateFromMap({ type: "nebulosity.open", path: "src/app/main.ts", line: 6 });
        assertActive("src/app/main.ts");
        // line 6 of the Map's 1-based numbering is the editor's line index 5
        assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 5);
        await delay(1_000);
        assert.ok(!api.sent.slice(from).some(isFollowOf("src/app/main.ts")), `The opened file was followed back: ${JSON.stringify(api.sent.slice(from))}`);
        // the pick never moved the Map, so the switch back shows as a follow, not as a drawn (P16)
        const followed = api.waitForSent(isFollowOf("src/core/log.ts"), 5_000);
        await openFile("src/core/log.ts");
        await expectWait(followed, "No follow of src/core/log.ts after switching back");
    });

    test("an open for a file not in this workspace opens nothing", async () => {
        const before = tabs();
        // a file this copy doesn't have (the Map showing another repo, Review Focus 4)
        await api.simulateFromMap({ type: "nebulosity.open", path: "src/nope.ts" });
        // paths with a ".." segment, refused before any lookup (P17): each resolves to a real file, src/app/main.ts, so only
        // the refusal keeps it from opening. One leaves the copy and comes back in by its folder name
        const copyName = folder().uri.path.split("/").filter((segment) => segment !== "").pop() ?? "";
        await api.simulateFromMap({ type: "nebulosity.open", path: `../${copyName}/src/app/main.ts` });
        await api.simulateFromMap({ type: "nebulosity.open", path: "src/../src/app/main.ts" });
        assertActive("src/core/log.ts");
        assert.strictEqual(tabs(), before);
    });

    test("What depends asks /api/imports", async () => {
        assertActive("src/core/log.ts");
        const highlight = api.waitForSent((m) => m.type === "nebulosity.highlight", 10_000);
        // not awaited: the command resolves only once its pick hides
        const command = Promise.resolve(vscode.commands.executeCommand("nebulosity.whatDepends"));
        const lit = (await expectWait(highlight, "No highlight from What depends")) as Highlight;
        // log.ts' direct importers, nearest first, then by in-degree (main.ts imported by 3), then by path
        assert.deepStrictEqual(lit.paths, ["src/app/main.ts", "src/core/index.ts", "src/index.ts"]);
        const cleared = api.waitForSent((m) => m.type === "nebulosity.clear", 5_000);
        await closeQuickOpenUntil(cleared);
        await expectWait(cleared, "No clear when the pick closed");
        await command;
    });

    test("Show this file on an unindexed file says so", async () => {
        // the worker is off, so the index never learns of this file
        const fresh = fileUri("src/new.ts");
        await vscode.workspace.fs.writeFile(fresh, Buffer.from("export const fresh = 1;\n", "utf8"));
        // the premise: the index doesn't hold it, so the command's own /api/imports question gets a 404
        const premise = await fetch(`${MAP}/api/imports?path=src/new.ts&limit=1`);
        assert.strictEqual(premise.status, 404);
        const from = api.sent.length;
        const shown = api.waitForSent((m) => m.type === "nebulosity.show", 2_000).then(() => true, () => false);
        // the command's message isn't awaited, so it resolves
        await vscode.commands.executeCommand("nebulosity.showFile", fresh);
        // a show would be posted before the command resolves, however long it took; the timed wait covers a late one
        assert.deepStrictEqual(api.sent.slice(from).filter((m) => m.type === "nebulosity.show"), []);
        assert.strictEqual(await shown, false, `A show was posted for a file the index doesn't hold: ${JSON.stringify(api.sent.slice(-3))}`);
    });

    test("Show this file on an indexed file shows it", async () => {
        const drawn = api.waitFor(drawnOf("src/util/strings.ts"), 10_000);
        await vscode.commands.executeCommand("nebulosity.showFile", fileUri("src/util/strings.ts"));
        const shown = (await expectWait(drawn, "The Map didn't draw src/util/strings.ts selected")) as Drawn;
        assert.strictEqual(shown.path, "src/util");
        assert.ok(api.sent.some((m) => isDeepStrictEqual(m, { type: "nebulosity.show", path: "src/util/strings.ts" })), `No show: ${JSON.stringify(api.sent.slice(-3))}`);
    });

    test("a reopened panel follows the active editor", async () => {
        assertActive("src/core/log.ts");
        api.closePanel();
        // the new page's handshake resets the follow gate, then follows the editor (Review Focus 2, P16)
        const drawn = api.waitFor(drawnOf("src/core/log.ts"), 30_000);
        await vscode.commands.executeCommand("nebulosity.showMap");
        await expectWait(drawn, "The reopened panel's Map didn't draw src/core/log.ts selected");
    });

    test("Show this file with the panel closed isn't overridden by the follow", async () => {
        assertActive("src/core/log.ts");
        api.closePanel();
        const from = api.sent.length;
        const drawn = api.waitFor(drawnOf("src/app/main.ts"), 30_000);
        await vscode.commands.executeCommand("nebulosity.showFile", fileUri("src/app/main.ts"));
        await expectWait(drawn, "The new panel's Map didn't draw src/app/main.ts selected");
        // the follow after the new page's ready gives way to the show posted to it (P16)
        const show = api.sent.findIndex((m, i) => i >= from && isDeepStrictEqual(m, { type: "nebulosity.show", path: "src/app/main.ts" }));
        assert.ok(show >= 0, `No show of src/app/main.ts: ${JSON.stringify(api.sent.slice(from))}`);
        const followsAfter = (): ToMap[] => api.sent.slice(show + 1).filter((m) => m.type === "nebulosity.follow");
        assert.deepStrictEqual(followsAfter(), []);
        await delay(1_000);
        assert.deepStrictEqual(followsAfter(), []);
    });

    test("Claude's show_on_map moves the panel's Map, and the next editor switch moves it back", async () => {
        const focused = api.waitFor(drawnOf("src/core/index.ts"), 10_000);
        const response = await fetch(`${MAP}/api/live`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: "show_on_map", paths: ["src/core/index.ts"], action: { type: "focus_node", nodeId: "src/core/index.ts" } }),
        });
        assert.strictEqual(response.status, 204);
        await expectWait(focused, "The live event didn't move the Map to src/core/index.ts");
        const back = api.waitFor(drawnOf("src/util/strings.ts"), 10_000);
        await openFile("src/util/strings.ts");
        await expectWait(back, "The editor switch didn't move the Map to src/util/strings.ts");
    });

    test("Stop Map stops the Map it started", async () => {
        await vscode.commands.executeCommand("nebulosity.stopMap");
        const deadline = Date.now() + 10_000;
        let stopped = await refused();
        while (!stopped && Date.now() < deadline){
            await delay(250);
            stopped = await refused();
        }
        assert.ok(stopped, `Port ${PORT} still answers 10 s after Stop Map.`);
    });

    test("Show Map starts it again", async () => {
        const drawn = api.waitFor(drawnOf(), 90_000);
        await vscode.commands.executeCommand("nebulosity.showMap");
        // left running: VS Code's exit has to stop it (deactivate), which the step after the run checks
        await expectWait(drawn, "No drawn after Show Map started the Map again");
    });
});
