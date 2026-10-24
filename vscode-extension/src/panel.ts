import { randomBytes } from "crypto";
import * as vscode from "vscode";
import type { BridgeFromMap, BridgeToMap } from "../../lib/contracts";
import { readFromWebview } from "./fromWebview";
import type { MapServer } from "./mapServer";
import { panelHtml, type PanelState } from "./panelHtml";
import { panelColumn } from "./syncRules";
import type { RelayCommand } from "./webview/relay";

/**
 * The editor panel that holds the Map (design §4.1): one per window, beside the code. Its page is panelHtml's for the
 * state it's in, and its script, the relay, carries the editor bridge to and from the Map's iframe. The extension's
 * messages go to the relay wrapped as `{ to: "map", message }`; what comes back is read by readFromWebview.
 */
export class MapPanel {
    static readonly viewType = "nebulosity.map";
    private static current: MapPanel | null = null;
    /** Pages rendered in this window, by every panel: each page's number is new, whichever panel it's in. */
    private static rendered = 0;

    private now: PanelState = { kind: "starting" };
    private pageNumber = 0;
    private readonly fromMap = new vscode.EventEmitter<BridgeFromMap>();
    private readonly disposables: vscode.Disposable[] = [];
    private disposed = false;

    private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri, private readonly server: MapServer){
        panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon.png");
        this.disposables.push(
            panel.webview.onDidReceiveMessage((data: unknown) => this.receive(data)),
            panel.onDidDispose(() => this.cleanUp()),
            this.fromMap,
        );
        this.render();
    }

    /**
     * The open panel, revealed, or a new one beside the active editor (in a column 2 of its own when nothing is open, so
     * the next file opened doesn't cover it: syncRules' panelColumn), which says "Starting the Map…" until told more.
     */
    static async show(context: vscode.ExtensionContext, server: MapServer): Promise<MapPanel> {
        if (MapPanel.current !== null){
            MapPanel.current.reveal();
            return MapPanel.current;
        }
        const groups = vscode.window.tabGroups.all;
        const place = panelColumn(groups.length === 1 && groups[0].tabs.length === 0, vscode.ViewColumn.Beside);
        if (place.split) await vscode.commands.executeCommand("vscode.setEditorLayout", { orientation: 0, groups: [{}, {}] });
        // a second Show Map may have made the panel while the layout changed: that panel is the one
        const made = MapPanel.open;
        if (made !== null){
            made.reveal();
            return made;
        }
        const panel = vscode.window.createWebviewPanel(
            MapPanel.viewType,
            "Nebulosity Map",
            // preserveFocus also leaves the active column where it was (column 1 with nothing open), so files open there
            { viewColumn: place.column as vscode.ViewColumn, preserveFocus: true },
            // the context stays while the panel is hidden, so the live stream and the Map's place survive a tab switch
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] },
        );
        MapPanel.current = new MapPanel(panel, context.extensionUri, server);
        return MapPanel.current;
    }

    /** The panel, when one is open. */
    static get open(): MapPanel | null {
        return MapPanel.current;
    }

    get state(): PanelState {
        return this.now;
    }

    /**
     * The page the panel shows, as a number no other page in this window has: a new one for every setState and reload.
     * The sync tells by it whether a `ready` comes from the page a `show` was posted to (syncRules' ShowHold).
     */
    get page(): number {
        return this.pageNumber;
    }

    /** The editor column the panel is in (undefined while it isn't shown in one). */
    get viewColumn(): vscode.ViewColumn | undefined {
        return this.panel.viewColumn;
    }

    /** Shows a state. Each state is a new page, so a Map shown again loads afresh. */
    setState(state: PanelState): void {
        this.now = state;
        this.render();
    }

    /** A bridge message for the Map. The relay holds it until the Map's page is ready (P9). */
    post(message: BridgeToMap): void {
        if (!this.disposed) void this.panel.webview.postMessage({ to: "map", message });
    }

    /** The Map's messages (API_CONTRACTS §20), checked. */
    onMessage(fn: (message: BridgeFromMap) => void): vscode.Disposable {
        return this.fromMap.event(fn);
    }

    /** Loads the Map's page again (P7): after the extension switched its repo, or indexed one. Only in the map state. */
    reload(): void {
        if (this.now.kind === "map") this.render();
    }

    reveal(): void {
        if (!this.disposed) this.panel.reveal(undefined, true);
    }

    dispose(): void {
        this.panel.dispose();
    }

    private render(): void {
        if (this.disposed) return;
        this.pageNumber = ++MapPanel.rendered;
        const relay = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "relay.js"));
        // a new nonce for every page, which also makes the page new when the state is the same one (a reload)
        this.panel.webview.html = panelHtml(this.now, { nonce: randomBytes(16).toString("hex"), relayUri: relay.toString() });
    }

    private receive(data: unknown): void {
        const message = readFromWebview(data);
        if (message === null) return;
        switch (message.kind){
            case "command":
                void this.run(message.command);
                return;
            case "frameError":
                // the frame loaded and the Map never answered: its server is gone (P18)
                if (this.now.kind === "map") this.setState({ kind: "stopped" });
                return;
            case "map":
                this.fromMap.fire(message.message);
                return;
        }
    }

    /** A button on the panel's page. */
    private async run(command: RelayCommand): Promise<void> {
        switch (command){
            case "start":
                await vscode.commands.executeCommand("nebulosity.showMap");
                return;
            case "indexRepo":
                await vscode.commands.executeCommand("nebulosity.indexRepo");
                return;
            case "showLog":
                this.server.output.show();
                return;
        }
    }

    private cleanUp(): void {
        this.disposed = true;
        if (MapPanel.current === this) MapPanel.current = null;
        for (const disposable of this.disposables) disposable.dispose();
    }
}
