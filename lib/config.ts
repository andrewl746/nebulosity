import fs from "fs";
import path from "path";
import { dataPath } from "./home";

/** The port the Map's server listens on (npm run dev's default); live events are posted to it (PIVOT_SPEC.md §8). */
export const DEFAULT_PORT = 3000;

/**
 * Small user-level settings that outlive any one run (API_CONTRACTS.md §21). Keys this version doesn't know are kept
 * as found too, so a newer copy's settings survive an older copy's rewrite.
 */
export type NebulosityConfig = {
    activeRepo: string | null;
    port: number;
    /**
     * The summary models (ADR-066) exactly as the file holds them, valid or not: resolveSummaryModels checks them when
     * summaries are planned, so a broken setting never stops the Map from starting, and a rewrite never drops it.
     */
    summaryModels?: unknown;
};

/** The settings file: config.json in the data folder (NEBULOSITY_DATA moves it). Messages that send people there name it. */
export function configPath(): string {
    return dataPath("config.json");
}

export function readConfig(): NebulosityConfig {
    try{
        const raw: unknown = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        // only an object has settings; anything else reads as nothing chosen yet, and its keys aren't spread into ours
        const found = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        const port = typeof found.port === "number" && Number.isInteger(found.port) && found.port > 0 && found.port < 65_536 ? found.port : DEFAULT_PORT;
        // Everything else as found: the Map's repo picker and `nebulosity index` rewrite the file with
        // writeConfig({ ...readConfig(), activeRepo }), and that must keep summaryModels (Review Focus 1).
        return { ...found, activeRepo: typeof found.activeRepo === "string" ? found.activeRepo : null, port };
    } catch{
        return { activeRepo: null, port: DEFAULT_PORT };   // missing or unreadable: nothing chosen yet
    }
}

export function writeConfig(config: NebulosityConfig): void {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}
