import * as vscode from "vscode";
import type { BridgeFromMap, BridgeToMap, ImportsResponse } from "../../lib/contracts";
import { pickItems, pickNote, pickTitle } from "./dependents";
import { FOLLOW_DEBOUNCE_MS, FollowGate } from "./followGate";
import { errorText, getJson, mapUrl, RefusedError, type HttpAnswer } from "./http";
import { PROBE_TIMEOUT_MS } from "./mapServer";
import { MessageLog } from "./messageLog";
import { MapPanel } from "./panel";
import { checkRepoPath, uriPathOf } from "./repoMatch";
import { classifyRepos, type ServerCheck } from "./serverCheck";
import {
    highlightOf, importsPath, isFileUri, isNotFound, notIndexedText, openCheck, openColumn, otherRepoText, PICK_LIMIT, readImports,
    repoPathOfUri, SHOW_ALL_LABEL, ShowHold, showAllOffered,
} from "./syncRules";

/**
 * The two-way sync between the editor and the Map in the panel (design §4.4–§4.5, V1.8 plan P4–P6, P10, P16, P17):
 * - the Map follows the active editor, through the follow gate, which keeps what the Map shows;
 * - a file box or a declaration picked on the Map opens in the editor beside the panel, when this workspace has it;
 * - "Show this file on the Map" and "What depends on this file?" with its QuickPick;
 * - the Follow editor toggle, for this window only.
 * Everything reaches the Map as a bridge message through the panel (API_CONTRACTS §20). The integration tests and the
 * benchmarks read those messages through NebulosityApi.
 */

/** How long an `/api/imports` answer may take: a first transitive one on a big repo walks its whole import index. */
const IMPORTS_TIMEOUT_MS = 10_000;

/** The Map the panel shows: its port and the repo root (extension.ts' openMap sets it). */
export type ShownMap = { port: number; root: string | null };

/** What the sync needs from the rest of the extension. */
export type SyncHost = {
    /** The Map the panel shows, or null before one was shown. */
    shown(): ShownMap | null;
    /** The workspace folder whose repo the Map shows, or undefined with no folder open. */
    folder(): vscode.WorkspaceFolder | undefined;
    /** Nebulosity: Show Map: the panel, revealed, on the Map of the workspace's repo. */
    showMap(): Promise<void>;
};

/** For the integration tests and the benchmarks only (V1.8 plan Task 8): activate returns it in ExtensionMode.Test. */
export type NebulosityApi = {
    sent: BridgeToMap[];
    received: BridgeFromMap[];
    /** Handles a message as if the Map had sent it, and resolves once it's handled (an open: once the editor shows it). */
    simulateFromMap(m: BridgeFromMap): Promise<void>;
    /** The first message received after the call that `pred` accepts, never one already in `received`. */
    waitFor(pred: (m: BridgeFromMap) => boolean, timeoutMs: number): Promise<BridgeFromMap>;
    /** The first message sent after the call that `pred` accepts, never one already in `sent`. */
    waitForSent(pred: (m: BridgeToMap) => boolean, timeoutMs: number): Promise<BridgeToMap>;
    /** Disposes the panel: it's revealed with preserveFocus, so closing the active editor would close the code instead. */
    closePanel(): void;
    /** The port of the Map the panel shows. */
    port(): number | null;
};

/**
 * A row of What depends' pick: a file, or with no path the line under the files, the note on a list cut short (which
 * does nothing when picked) and "Show all, including indirect".
 */
type DependentItem = vscode.QuickPickItem & { path: string | null };

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The pick's rows for an answer: its files, nearest first, then the note when the page cut them short, then "Show all"
 * when there are indirect importers to ask for (`oneIndirect`, the transitive page of one entry; null after Show all).
 */
function itemsOf(r: ImportsResponse, oneIndirect: ImportsResponse | null): DependentItem[] {
    const items: DependentItem[] = pickItems(r);
    const note = pickNote(r);
    const showAll = showAllOffered(r, oneIndirect);
    if (note !== null || showAll) items.push({ label: "", kind: vscode.QuickPickItemKind.Separator, path: null });
    if (note !== null) items.push(note);
    // alwaysShow: typing to filter the files still leaves the way to the rest
    if (showAll) items.push({ label: SHOW_ALL_LABEL, alwaysShow: true, path: null });
    return items;
}

export class EditorSync implements vscode.Disposable {
    private readonly gate = new FollowGate(() => Date.now());
    private readonly hold = new ShowHold();
    /** The messages, kept only for the tests (null otherwise, so a long session keeps nothing). */
    private readonly sent: MessageLog<BridgeToMap> | null;
    private readonly received: MessageLog<BridgeFromMap> | null;
    /** The panels whose messages are heard: each is attached once. */
    private readonly attached = new WeakSet<MapPanel>();
    private readonly disposables: vscode.Disposable[] = [];
    /** Follow editor, for this window (P4): it starts from the setting and is never written back. */
    private following: boolean;
    /** The last text editor that was active, and its column: a click in the panel leaves no active text editor. */
    private lastEditor: vscode.TextEditor | undefined;
    private lastColumn: vscode.ViewColumn | undefined;
    private followTimer: ReturnType<typeof setTimeout> | undefined;
    /** What depends' pick while it's open: its highlights are the Map's until it hides (P6). */
    private pick: vscode.QuickPick<DependentItem> | null = null;

    constructor(private readonly host: SyncHost, recording: boolean){
        this.sent = recording ? new MessageLog<BridgeToMap>() : null;
        this.received = recording ? new MessageLog<BridgeFromMap>() : null;
        this.following = vscode.workspace.getConfiguration("nebulosity").get<boolean>("followEditor") ?? true;
        void vscode.commands.executeCommand("setContext", "nebulosity.following", this.following);
        const editor = vscode.window.activeTextEditor;
        if (editor !== undefined) this.noteEditor(editor);
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor((active) => this.onEditor(active)));
    }

    /** Hears a panel's messages. Called for every panel the extension opens; the listener goes with the panel. */
    attach(panel: MapPanel): void {
        if (this.attached.has(panel)) return;
        this.attached.add(panel);
        panel.onMessage((message) => void this.receive(panel, message));
    }

    /** The title-bar toggle (P4): this window only. Turned back on, the Map goes to the file you're in. */
    setFollowing(on: boolean): void {
        this.following = on;
        void vscode.commands.executeCommand("setContext", "nebulosity.following", on);
        if (on) this.followEditor();
    }

    /** Nebulosity: Show this file on the Map: the resource the menu was opened on, else the active editor's file. */
    async showFile(arg?: unknown): Promise<void> {
        const target = this.targetOf(arg);
        if (target === undefined){
            void vscode.window.showInformationMessage("Open a file first: Nebulosity shows the active editor's file on the Map.");
            return;
        }
        const map = await this.mapFor();
        if (map === null) return;
        const path = this.repoPathOf(map.root, target);
        if (path === null) return;
        // one cheap request, so a file the index doesn't hold gets an answer rather than a Map that quietly stays (P5)
        if (await this.askImports(map.port, path, { limit: 1 }) === null) return;
        this.show(path);
    }

    /**
     * Nebulosity: What depends on this file? (design §4.5, P6): its direct importers in a QuickPick, up to 500, which
     * can re-ask with the indirect ones too when there are any. The Map shows the file with the listed importers lit,
     * until the pick hides. Picking a file opens it as a pick on the Map would, and the pick stays open for the next one.
     * Resolves when the pick hides.
     */
    async whatDepends(arg?: unknown): Promise<void> {
        const target = this.targetOf(arg);
        if (target === undefined){
            void vscode.window.showInformationMessage("Open a file first: Nebulosity lists what imports the active editor's file.");
            return;
        }
        const map = await this.mapFor();
        if (map === null) return;
        const path = this.repoPathOf(map.root, target);
        if (path === null) return;
        // the direct page, and beside it one transitive entry, whose total says whether "Show all" would add anything
        const [direct, oneIndirect] = await Promise.all([
            this.askImports(map.port, path, { limit: PICK_LIMIT }),
            this.peekImports(map.port, path, { transitive: true, limit: 1 }),
        ]);
        if (direct === null) return;

        const pick = vscode.window.createQuickPick<DependentItem>();
        // a pick still open from a run before gives way, and its hiding clears nothing: the lights are this one's now
        const previous = this.pick;
        this.pick = pick;
        previous?.hide();
        pick.title = pickTitle(direct);
        pick.items = itemsOf(direct, oneIndirect);
        pick.matchOnDescription = true;
        this.show(path);
        this.post({ type: "nebulosity.highlight", paths: highlightOf(direct) });

        await new Promise<void>((resolve) => {
            pick.onDidAccept(() => {
                const item = pick.selectedItems[0] ?? pick.activeItems[0];
                if (item === undefined) return;
                // the Map stays on the file asked about, with its importers lit: the gate keeps that (Task 8 Review M1)
                if (item.path !== null) void this.openFile(item.path, undefined, path);
                // the note on a list cut short has no path either, and does nothing
                else if (item.label === SHOW_ALL_LABEL) void this.showAll(pick, map.port, path);
            });
            pick.onDidHide(() => {
                // however it closes (P6)
                if (this.pick === pick){
                    this.pick = null;
                    this.post({ type: "nebulosity.clear" });
                }
                pick.dispose();
                resolve();
            });
            pick.show();
        });
    }

    /** The tests' view of the bridge (NebulosityApi). Only for a sync that records. */
    api(): NebulosityApi {
        const sent = this.sent;
        const received = this.received;
        if (sent === null || received === null) throw new Error("This EditorSync keeps no messages: it was made with recording off.");
        return {
            sent: sent.all,
            received: received.all,
            simulateFromMap: (m) => this.receive(MapPanel.open, m),
            waitFor: (pred, timeoutMs) => received.waitFor(pred, timeoutMs),
            waitForSent: (pred, timeoutMs) => sent.waitFor(pred, timeoutMs),
            closePanel: () => MapPanel.open?.dispose(),
            port: () => this.host.shown()?.port ?? null,
        };
    }

    dispose(): void {
        if (this.followTimer !== undefined) clearTimeout(this.followTimer);
        this.pick?.dispose();
        for (const disposable of this.disposables) disposable.dispose();
    }

    // ─── The Map's messages ───

    private async receive(panel: MapPanel | null, message: BridgeFromMap): Promise<void> {
        this.received?.add(message);
        switch (message.type){
            case "nebulosity.ready":
                this.onReady(panel);
                return;
            case "nebulosity.drawn":
                // the gate follows the Map (P16): what it drew selected is what it shows
                this.gate.mapShows(message.selected);
                return;
            case "nebulosity.open":
                await this.openFile(message.path, message.line);
                return;
        }
    }

    /**
     * A new handshake: the Map's page is new, so what it shows is unknown and the gate forgets it. Then the Map goes to
     * the active editor's file, unless a `show` was posted to this page (syncRules' ShowHold), or follow is off.
     */
    private onReady(panel: MapPanel | null): void {
        if (panel === null || panel !== MapPanel.open) return;
        this.gate.reset();
        if (!this.following || !this.hold.followOnReady(panel.page)) return;
        const path = this.editorPath();
        if (path !== null && this.gate.shouldFollow(path)) this.follow(path);
    }

    /**
     * A file the Map picked (a file box or a declaration, P10), or What depends' pick, opens in the editor: in the most
     * recent text editor's column, or beside the panel when that's the panel's own (never in the panel's column, which
     * it would cover: syncRules' openColumn), as a preview, the focus left where it is. Only a repo-relative path is
     * taken, only while the Map still shows the repo the panel was shown for, and only a file this workspace has (P17):
     * the Map may show another repo, switched from its own menu or by another window (Review Focus 4). `shows` is what
     * the Map shows afterwards when that isn't the file opened: What depends' target.
     */
    private async openFile(raw: string, line?: number, shows?: string): Promise<void> {
        const path = checkRepoPath(raw);
        const shown = this.host.shown();
        if (path === null || shown === null || shown.root === null) return;
        // a path both repos have (README.md, package.json) passes the stat below, so the Map's repo is asked first
        if (!await this.mapStillShows(shown.port, shown.root, path)) return;
        const uri = this.fileUri(shown.root, path);
        let stat: vscode.FileStat | null = null;
        try{
            stat = await vscode.workspace.fs.stat(uri);
        } catch{
            // missing here: the message says why, and isn't waited on
        }
        if (stat === null || (stat.type & vscode.FileType.File) === 0){
            void vscode.window.showInformationMessage(otherRepoText(path));
            return;
        }
        // its editor change is an echo, never followed back
        this.gate.opened(path, shows ?? path);
        const viewColumn = openColumn(this.lastColumn, MapPanel.open?.viewColumn) as vscode.ViewColumn;
        const selection = line !== undefined && line >= 1 ? new vscode.Range(line - 1, 0, line - 1, 0) : undefined;
        try{
            await vscode.window.showTextDocument(uri, { viewColumn, preview: true, preserveFocus: true, selection });
        } catch (err){
            void vscode.window.showErrorMessage(`Nebulosity couldn't open ${path}: ${messageOf(err)}`);
        }
    }

    /**
     * Whether the Map's active repo is still `root` (`GET /api/repos`, syncRules' openCheck), or false once the user has
     * been told why the file didn't open: another repo on the Map, a Map that stopped (P18), or an answer that can't say.
     */
    private async mapStillShows(port: number, root: string, path: string): Promise<boolean> {
        const unchecked = (reason: string): void => {
            void vscode.window.showErrorMessage(`Nebulosity couldn't check which repo the Map shows, so ${path} didn't open: ${reason}`);
        };
        let check: ServerCheck;
        try{
            const answer = await getJson(mapUrl(port, "/api/repos"), PROBE_TIMEOUT_MS);
            check = classifyRepos(answer.status, answer.body);
        } catch (err){
            const panel = MapPanel.open;
            if (err instanceof RefusedError && panel !== null && panel.state.kind === "map") panel.setState({ kind: "stopped" });
            else unchecked(messageOf(err));
            return false;
        }
        switch (openCheck(check, root, process.platform)){
            case "open":
                return true;
            case "otherRepo":
                void vscode.window.showInformationMessage(otherRepoText(path));
                return false;
            case "unknown":
                unchecked(`port ${port} doesn't answer as this Map.`);
                return false;
        }
    }

    /**
     * The file's URI in the workspace: the root as the index stores it, with the folder's scheme and authority (a remote
     * workspace's included), or with no folder open a file on this machine (P15).
     */
    private fileUri(root: string, path: string): vscode.Uri {
        const folder = this.host.folder();
        return folder === undefined ? vscode.Uri.file(`${root}/${path}`) : folder.uri.with({ path: `${uriPathOf(root)}/${path}` });
    }

    // ─── The editor's side ───

    private noteEditor(editor: vscode.TextEditor): void {
        this.lastEditor = editor;
        if (editor.viewColumn !== undefined) this.lastColumn = editor.viewColumn;
    }

    /**
     * The active editor changed. A change to no text editor (a click in the panel) is left out, so the follow still goes
     * to the last file you were in. A burst of switches gives one follow, FOLLOW_DEBOUNCE_MS after the last.
     */
    private onEditor(active: vscode.TextEditor | undefined): void {
        if (active === undefined) return;
        this.noteEditor(active);
        if (this.followTimer !== undefined) clearTimeout(this.followTimer);
        this.followTimer = setTimeout(() => {
            this.followTimer = undefined;
            this.followEditor();
        }, FOLLOW_DEBOUNCE_MS);
    }

    /** Editor → Map: follow the editor's file, if following, the panel shows the Map, and the gate lets it through. */
    private followEditor(): void {
        if (!this.following) return;
        const path = this.editorPath();
        if (path !== null && this.gate.shouldFollow(path)) this.follow(path);
    }

    /**
     * The active editor (else the last one) as a path in the shown repo, while the panel is on the Map; else null. Only a
     * file on disk: a `git:` diff side or a notebook cell keeps the file's path but isn't the file (syncRules' repoPathOfUri).
     */
    private editorPath(): string | null {
        const panel = MapPanel.open;
        const shown = this.host.shown();
        if (panel === null || panel.state.kind !== "map" || shown === null || shown.root === null) return null;
        const editor = this.currentEditor();
        return editor === undefined ? null : repoPathOfUri(shown.root, editor.document.uri, process.platform);
    }

    private currentEditor(): vscode.TextEditor | undefined {
        const editor = vscode.window.activeTextEditor ?? this.lastEditor;
        return editor === undefined || editor.document.isClosed ? undefined : editor;
    }

    /**
     * The file a command is for: the resource its menu was opened on, else the active editor's. Only a file on disk (the
     * menus already ask for `resourceScheme == file`; the palette doesn't), so a `git:` document is "no file".
     */
    private targetOf(arg: unknown): vscode.Uri | undefined {
        const uri = arg instanceof vscode.Uri ? arg : this.currentEditor()?.document.uri;
        return uri !== undefined && isFileUri(uri) ? uri : undefined;
    }

    // ─── Talking to the Map ───

    /**
     * The panel on the Map of the workspace's repo, through Show Map: it finds or starts the Map, switches the Map back
     * to this workspace's repo if it shows another (Review Focus 4), and reveals the panel. Null when the panel ends up
     * on anything but the Map: it says why there (not installed, not indexed, stopped…).
     */
    private async mapFor(): Promise<{ port: number; root: string } | null> {
        await this.host.showMap();
        const panel = MapPanel.open;
        const shown = this.host.shown();
        if (panel === null || panel.state.kind !== "map" || shown === null || shown.root === null) return null;
        return { port: shown.port, root: shown.root };
    }

    /** The file's path in the repo, or null (and P5's message) when it's outside it. */
    private repoPathOf(root: string, target: vscode.Uri): string | null {
        const path = repoPathOfUri(root, target, process.platform);
        if (path === null) void vscode.window.showInformationMessage(notIndexedText(vscode.workspace.asRelativePath(target, false)));
        return path;
    }

    /**
     * One page of the path's dependents (API_CONTRACTS §19), or null once the user has been told why not: a file the
     * index doesn't hold (P5), a Map that stopped (P18: a refused request in the map state), or another failure.
     */
    private async askImports(port: number, path: string, options: { transitive?: boolean; limit?: number }): Promise<ImportsResponse | null> {
        let answer: HttpAnswer;
        try{
            answer = await getJson(mapUrl(port, importsPath({ path, ...options })), IMPORTS_TIMEOUT_MS);
        } catch (err){
            const panel = MapPanel.open;
            if (err instanceof RefusedError && panel !== null && panel.state.kind === "map") panel.setState({ kind: "stopped" });
            else void vscode.window.showErrorMessage(`Nebulosity couldn't ask the Map about ${path}: ${messageOf(err)}`);
            return null;
        }
        if (isNotFound(answer.status, answer.body)){
            void vscode.window.showInformationMessage(notIndexedText(path));
            return null;
        }
        const imports = answer.status === 200 ? readImports(answer.body) : null;
        if (imports === null) void vscode.window.showErrorMessage(`Nebulosity couldn't ask the Map about ${path}: ${errorText(answer.status, answer.body)}`);
        return imports;
    }

    /**
     * One page of the path's dependents, or null on any failure, with nothing said: the transitive entry beside What
     * depends' direct page, which only decides whether "Show all" is offered (askImports speaks for both).
     */
    private async peekImports(port: number, path: string, options: { transitive: boolean; limit: number }): Promise<ImportsResponse | null> {
        try{
            const answer = await getJson(mapUrl(port, importsPath({ path, ...options })), IMPORTS_TIMEOUT_MS);
            return answer.status === 200 ? readImports(answer.body) : null;
        } catch{
            return null;
        }
    }

    /** "Show all, including indirect": the same pick, re-asked with the indirect importers, and those lit instead. */
    private async showAll(pick: vscode.QuickPick<DependentItem>, port: number, path: string): Promise<void> {
        pick.busy = true;
        const all = await this.askImports(port, path, { transitive: true, limit: PICK_LIMIT });
        // the pick may have closed while the answer came
        if (this.pick !== pick) return;
        pick.busy = false;
        if (all === null) return;
        pick.title = pickTitle(all);
        // the text typed to reach "Show all" would hide every file of the new list
        pick.value = "";
        pick.items = itemsOf(all, null);
        this.post({ type: "nebulosity.highlight", paths: highlightOf(all) });
    }

    /** A follow goes out: the Map is at the editor's file, so a show no longer holds the follow after ready. */
    private follow(path: string): void {
        if (this.post({ type: "nebulosity.follow", path }) !== null) this.hold.followPosted();
    }

    /**
     * A deliberate jump (Show this file, What depends): the Map shows it (P16), as an ask, so a late `drawn` from before
     * can't stand for what it shows (Task 8 Review M2); and its page's next ready won't follow.
     */
    private show(path: string): void {
        const panel = this.post({ type: "nebulosity.show", path });
        if (panel === null) return;
        this.gate.posted(path);
        this.hold.showPosted(panel.page);
    }

    /**
     * Posts to the panel while it shows the Map; the panel it went to, or null. Outside the map state the page has no Map
     * to hear it. Called only after a setState or reload has returned: VS Code drops what was posted to a page it's
     * replacing, and the new page's relay holds what comes after until the Map is ready.
     */
    private post(message: BridgeToMap): MapPanel | null {
        const panel = MapPanel.open;
        if (panel === null || panel.state.kind !== "map") return null;
        panel.post(message);
        this.sent?.add(message);
        return panel;
    }
}
