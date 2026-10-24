import type { BRIDGE_VERSION, BridgeFromMap } from "../../lib/contracts";
import type { RelayCommand } from "./webview/relay";

/**
 * What the extension reads from its webview (webview/relay.ts): a button's command, the relay's own word that the frame
 * never answered (P18), or one of the Map's messages, which the relay passes on as the Map sent them. The webview is
 * another program, so every field is checked here, and a message keeps only the fields checked, as the Map does with
 * the editor's (app/map/embed.ts' parseToMap, which the extension can't import, P3).
 */
export type FromWebview = { kind: "command"; command: RelayCommand } | { kind: "frameError" } | { kind: "map"; message: BridgeFromMap };

/** The commands as a record, so it can't fall out of step with RelayCommand without a compile error. */
const COMMANDS: Record<RelayCommand, true> = { start: true, showLog: true, indexRepo: true };

/** The bridge this extension speaks: BRIDGE_VERSION's literal type, which a type import can bring (serverCheck.ts does the same). */
const BRIDGE: typeof BRIDGE_VERSION = 1;

/** A stored repo-relative path's longest spelling (API_CONTRACTS §20). */
const MAX_PATH_LENGTH = 1_024;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isPath = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_PATH_LENGTH;
const isWhole = (value: unknown, least: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= least;

/** The Map's message, checked: null for anything that isn't exactly one of BridgeFromMap's. */
function readMapMessage(message: Record<string, unknown>): BridgeFromMap | null {
    switch (message.type){
        case "nebulosity.ready":
            return message.version === BRIDGE ? { type: "nebulosity.ready", version: BRIDGE } : null;
        case "nebulosity.open":
            if (!isPath(message.path)) return null;
            // line is 1-based (a declaration's startLine), and absent for a file box
            if (message.line === undefined) return { type: "nebulosity.open", path: message.path };
            return isWhole(message.line, 1) ? { type: "nebulosity.open", path: message.path, line: message.line } : null;
        case "nebulosity.drawn":
            if (!isPath(message.path) || !isWhole(message.page, 0)) return null;
            if (message.selected !== null && !isPath(message.selected)) return null;
            return { type: "nebulosity.drawn", path: message.path, page: message.page, selected: message.selected };
        default:
            return null;
    }
}

/**
 * Reads one message from the webview. A message with a `type` is the relay's or the Map's and is never taken for a
 * command, so nothing the Map's page sends can press a button.
 */
export function readFromWebview(data: unknown): FromWebview | null {
    if (!isObject(data)) return null;
    if (typeof data.type === "string"){
        if (data.type === "relay.frameError") return { kind: "frameError" };
        const message = readMapMessage(data);
        return message === null ? null : { kind: "map", message };
    }
    const command = data.command;
    return typeof command === "string" && Object.hasOwn(COMMANDS, command) ? { kind: "command", command: command as RelayCommand } : null;
}
