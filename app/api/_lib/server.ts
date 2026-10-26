import fs from "fs";
import { BRIDGE_VERSION, type ServerInfo } from "@/lib/contracts";
import { nebulosityPath } from "@/lib/home";

let version: string | undefined;

/**
 * What this server is, for GET /api/repos (API_CONTRACTS.md §15): this copy's package version and the editor bridge's.
 * The version is read once, from the package.json beside the code the server runs (it can't change under a running server).
 */
export function serverInfo(): ServerInfo {
    version ??= (JSON.parse(fs.readFileSync(nebulosityPath("package.json"), "utf8")) as { version: string }).version;
    return { version, bridge: BRIDGE_VERSION };
}
