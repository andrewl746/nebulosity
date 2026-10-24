import { execFile } from "child_process";
import * as vscode from "vscode";
import type { RepoList } from "../../lib/contracts";
import { errorText, getJson, mapUrl, postJson, RefusedError } from "./http";
import { MapServer, PROBE_TIMEOUT_MS, StoppedError } from "./mapServer";
import { MapPanel } from "./panel";
import { mapFrameUrl, type PanelState } from "./panelHtml";
import { repoFor, upperCaseDrive } from "./repoMatch";
import { classifyRepos, type ServerCheck } from "./serverCheck";
import { EditorSync, type NebulosityApi, type ShownMap } from "./sync";

/**
 * The extension (design §4, ADR-062): "Nebulosity: Show Map" finds or starts the Map, puts the workspace's repo on it and
 * shows it in a panel; "Index this repo" indexes a repo the Map doesn't have, for free, in a terminal; "Stop Map" stops a
 * Map this window started. The editor and the Map follow each other, and "Show this file on the Map" and "What depends
 * on this file?" ask the Map about a file (sync.ts). Everything it asks the Map goes over HTTP (http.ts), and everything
 * it tells the Map goes over the editor bridge (panel.ts).
 */

/** How long switching the Map's repo may take: the server opens the repo and points its worker at it. */
const SWITCH_TIMEOUT_MS = 10_000;
/** How long `git rev-parse` may take to name the root to index. */
const GIT_TIMEOUT_MS = 5_000;
/** The task definition of an index run, so its end can be told from other tasks'. */
const INDEX_TASK = "nebulosity.index";

let context: vscode.ExtensionContext;
let server: MapServer | null = null;
let sync: EditorSync | null = null;

/** The Map the panel shows: its port and the repo root (the workspace's, or with no folder open the Map's active one). */
let shown: ShownMap | null = null;

/** The workspace folder of the last text editor that was active: a click in the panel leaves no active text editor. */
let lastFolder: vscode.WorkspaceFolder | undefined;

/**
 * Each pass that may set the panel's state takes the next number, and sets it only while it's still the newest: a Show
 * Map, a Start, a window focus and an index run's end can overlap, and the last one asked for wins.
 */
let generation = 0;
/** How many openMap passes are running: the focus check gives way to them, since each runs the repo step itself. */
let opening = 0;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The workspace folder the Map should show (design §4.3): the active editor's, else the last one's, else the first. */
function workspaceFolder(): vscode.WorkspaceFolder | undefined {
    const editor = vscode.window.activeTextEditor;
    const folder = (editor === undefined ? undefined : vscode.workspace.getWorkspaceFolder(editor.document.uri)) ?? lastFolder;
    const chosen = folder ?? vscode.workspace.workspaceFolders?.[0];
    // a virtual folder has no path on this machine to match or index
    return chosen?.uri.scheme === "file" ? chosen : undefined;
}

/** The root "Index this repo" offers for a folder: its git root (git's spelling), else the folder itself (P15). */
function rootToIndex(folderFsPath: string): Promise<string> {
    return new Promise((resolve) => {
        execFile("git", ["rev-parse", "--show-toplevel"], { cwd: folderFsPath, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
            const top = err ? "" : String(stdout).trim();
            resolve(upperCaseDrive(top !== "" ? top : folderFsPath, process.platform));
        });
    });
}

/** The state that tells the user who holds the port, for every answer but a current Map. */
function stateOf(check: Exclude<ServerCheck, { kind: "current" }>, port: number): PanelState {
    switch (check.kind){
        case "foreign": return { kind: "foreign", port };
        case "old": return { kind: "old" };
        case "mismatch": return { kind: "mismatch", bridge: check.bridge };
    }
}

type RepoStep = { kind: "repo"; root: string | null; switched: boolean } | { kind: "notIndexed"; root: string };

/**
 * The repo step (design §4.3, P15): the workspace folder's repo goes on the Map. With no folder open it's skipped, and
 * the Map's active repo stands. A folder no indexed repo holds gets the root to index. A repo other than the active one
 * is switched to with `POST /api/repos`, by the root as the index stores it.
 */
async function repoStep(port: number, list: RepoList): Promise<RepoStep> {
    const folder = workspaceFolder();
    if (folder === undefined) return { kind: "repo", root: list.active, switched: false };
    const repo = repoFor(list, folder.uri.fsPath, process.platform);
    if (repo === null) return { kind: "notIndexed", root: await rootToIndex(folder.uri.fsPath) };
    if (repo.root === list.active) return { kind: "repo", root: repo.root, switched: false };
    const answer = await postJson(mapUrl(port, "/api/repos"), { root: repo.root }, SWITCH_TIMEOUT_MS);
    if (answer.status !== 200) throw new Error(`The Map couldn't switch to ${repo.root}: ${errorText(answer.status, answer.body)}`);
    return { kind: "repo", root: repo.root, switched: true };
}

/**
 * Brings the panel to the Map of the workspace's repo (design §4.2–§4.3): find or start the Map, the repo step, then the
 * Map's page. The repo step runs before the page is shown, so its first load is the right repo. A panel already on the
 * Map reloads only when its repo changed, or with `reloadAnyway` (after an index run, whose data is new).
 */
async function openMap(panel: MapPanel, mapServer: MapServer, reloadAnyway: boolean): Promise<void> {
    const mine = ++generation;
    const current = (): boolean => mine === generation && MapPanel.open === panel;
    opening++;
    try{
        const found = await mapServer.ensure(() => {
            if (current()) panel.setState({ kind: "starting" });
        });
        if (!current()) return;
        if ("notInstalled" in found){
            panel.setState({ kind: "notInstalled" });
            return;
        }
        const { port, check } = found;
        if (check.kind !== "current"){
            panel.setState(stateOf(check, port));
            return;
        }
        const step = await repoStep(port, check.list);
        if (!current()) return;
        if (step.kind === "notIndexed"){
            panel.setState({ kind: "notIndexed", root: step.root });
            return;
        }
        shown = { port, root: step.root };
        const external = await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${port}`));
        if (!current()) return;
        const frameUrl = mapFrameUrl(external.toString());
        const now = panel.state;
        if (now.kind !== "map" || now.frameUrl !== frameUrl) panel.setState({ kind: "map", frameUrl });
        else if (step.switched || reloadAnyway) panel.reload();
    } catch (err){
        if (!current()) return;
        // a Map that went away between the answers, or was stopped while it started
        if (err instanceof RefusedError || err instanceof StoppedError) panel.setState({ kind: "stopped" });
        else panel.setState({ kind: "failed", message: messageOf(err) });
    } finally{
        opening--;
    }
}

/** The open panel, revealed, or a new one, whose messages the sync hears from the start. */
async function showPanel(mapServer: MapServer): Promise<MapPanel> {
    const panel = await MapPanel.show(context, mapServer);
    sync?.attach(panel);
    return panel;
}

/** Nebulosity: Show Map. */
async function showMap(mapServer: MapServer): Promise<void> {
    const panel = await showPanel(mapServer);
    await openMap(panel, mapServer, false);
}

/**
 * The window gained focus (P7): another window may have switched the Map to its own repo, so the repo step runs again
 * and the panel reloads when it switched back. Only while the panel shows the Map. A refused request means the Map
 * stopped (P18): the two-window case, where the window that started it closed.
 */
async function onFocus(): Promise<void> {
    const panel = MapPanel.open;
    if (panel === null || panel.state.kind !== "map" || shown === null || opening > 0) return;
    const mine = ++generation;
    const current = (): boolean => mine === generation && MapPanel.open === panel && panel.state.kind === "map";
    const port = shown.port;
    try{
        const answer = await getJson(mapUrl(port, "/api/repos"), PROBE_TIMEOUT_MS);
        const check = classifyRepos(answer.status, answer.body);
        if (!current()) return;
        if (check.kind !== "current"){
            panel.setState(stateOf(check, port));
            return;
        }
        const step = await repoStep(port, check.list);
        if (!current()) return;
        if (step.kind === "notIndexed"){
            panel.setState({ kind: "notIndexed", root: step.root });
            return;
        }
        shown = { port, root: step.root };
        if (step.switched) panel.reload();
    } catch (err){
        if (!current()) return;
        if (err instanceof RefusedError) panel.setState({ kind: "stopped" });
        // a timeout, or a switch that failed, leaves the panel as it is: the next focus or command asks again
        else server?.log(`The repo check on window focus failed: ${messageOf(err)}`);
    }
}

/** The data folder variables of this window's Map, for the index run, so the repo it indexes is the one the Map reads. */
function dataEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const name of ["NEBULOSITY_DATA", "NEBULOSITY_HOME"]){
        const value = process.env[name];
        if (value !== undefined && value !== "") env[name] = value;
    }
    return env;
}

/**
 * Nebulosity: Index this repo (design §4.3): `nebulosity index <root>` in a visible terminal, free. The root is the one
 * the panel offers, else the workspace folder's git root. The task is built from the unquoted launch, so VS Code quotes
 * each argument for the terminal's own shell (PowerShell by default on Windows), where withArgs' cmd.exe quoting would
 * reach node as literal characters. Its end is handled by onIndexEnd.
 */
async function indexRepo(mapServer: MapServer): Promise<void> {
    const panel = MapPanel.open;
    const folder = workspaceFolder();
    const root = panel?.state.kind === "notIndexed" ? panel.state.root : folder === undefined ? null : await rootToIndex(folder.uri.fsPath);
    if (root === null){
        void vscode.window.showInformationMessage("Open a folder first: Nebulosity indexes the repo it's in.");
        return;
    }
    const launch = mapServer.launch();
    if (launch === null){
        (panel ?? await showPanel(mapServer)).setState({ kind: "notInstalled" });
        return;
    }
    const args = [...launch.args, "index", root].map((value) => ({ value, quoting: vscode.ShellQuoting.Strong }));
    const execution = new vscode.ShellExecution(launch.command, args, { env: dataEnv() });
    const task = new vscode.Task({ type: INDEX_TASK, root }, folder ?? vscode.TaskScope.Workspace, "Index this repo", "Nebulosity", execution);
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
    mapServer.log(`Indexing ${root} in a terminal.`);
    await vscode.tasks.executeTask(task);
}

/** An index run ended: when it succeeded, the repo step runs again and the panel loads the Map afresh. */
function onIndexEnd(event: vscode.TaskProcessEndEvent, mapServer: MapServer): void {
    if (event.execution.task.definition.type !== INDEX_TASK) return;
    mapServer.log(`The index run ended with exit code ${event.exitCode ?? "unknown"}.`);
    const panel = MapPanel.open;
    if (event.exitCode === 0 && panel !== null) void openMap(panel, mapServer, true);
}

/** Nebulosity: Stop Map: only a Map this window started (design §4.2 step 5). */
async function stopMap(mapServer: MapServer): Promise<void> {
    if (!mapServer.startedByUs){
        void vscode.window.showInformationMessage("This Map wasn't started by this window; stop it where it was started.");
        return;
    }
    generation++;   // a Show Map still waiting on this Map's start gives way to the stop
    await mapServer.stop();
    MapPanel.open?.setState({ kind: "stopped" });
}

/**
 * Starts the extension. In ExtensionMode.Test (the integration tests and benchmarks, run by @vscode/test-electron) it
 * returns NebulosityApi, the bridge's messages as the tests read them; otherwise nothing, and no message is kept.
 */
export function activate(extensionContext: vscode.ExtensionContext): NebulosityApi | undefined {
    context = extensionContext;
    const output = vscode.window.createOutputChannel("Nebulosity");
    const mapServer = new MapServer(output);
    server = mapServer;
    const editor = vscode.window.activeTextEditor;
    lastFolder = editor === undefined ? undefined : vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const testing = context.extensionMode === vscode.ExtensionMode.Test;
    const editorSync = new EditorSync({ shown: () => shown, folder: workspaceFolder, showMap: () => showMap(mapServer) }, testing);
    sync = editorSync;

    context.subscriptions.push(
        output,
        editorSync,
        vscode.commands.registerCommand("nebulosity.showMap", () => showMap(mapServer)),
        // from a menu, the first argument is the file it was opened on; from the palette there's none (the active editor)
        vscode.commands.registerCommand("nebulosity.showFile", (resource?: unknown) => editorSync.showFile(resource)),
        vscode.commands.registerCommand("nebulosity.whatDepends", (resource?: unknown) => editorSync.whatDepends(resource)),
        vscode.commands.registerCommand("nebulosity.followOn", () => editorSync.setFollowing(true)),
        vscode.commands.registerCommand("nebulosity.followOff", () => editorSync.setFollowing(false)),
        vscode.commands.registerCommand("nebulosity.indexRepo", () => indexRepo(mapServer)),
        vscode.commands.registerCommand("nebulosity.stopMap", () => stopMap(mapServer)),
        vscode.window.onDidChangeActiveTextEditor((active) => {
            const folder = active === undefined ? undefined : vscode.workspace.getWorkspaceFolder(active.document.uri);
            if (folder !== undefined) lastFolder = folder;
        }),
        vscode.window.onDidChangeWindowState((state) => {
            if (state.focused) void onFocus();
        }),
        vscode.tasks.onDidEndTaskProcess((event) => onIndexEnd(event, mapServer)),
    );
    return testing ? editorSync.api() : undefined;
}

/** The window is closing: a Map it started stops with it, and VS Code waits for the process tree to go. */
export function deactivate(): Promise<void> | undefined {
    return server?.stop();
}
