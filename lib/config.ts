import fs from "fs";
import path from "path";
import { nebulosityPath } from "./home";

/** The port the Map's server listens on (npm run dev's default); live events are posted to it (PIVOT_SPEC.md §8). */
export const DEFAULT_PORT = 3000;

/** Small user-level settings that outlive any one run. */
export type NebulosityConfig = { activeRepo: string | null; port: number };

const configFile = (): string => nebulosityPath(".nebulosity", "config.json");

export function readConfig(): NebulosityConfig {
    try{
        const raw = JSON.parse(fs.readFileSync(configFile(), "utf8")) as { activeRepo?: unknown; port?: unknown };
        const port = typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65_536 ? raw.port : DEFAULT_PORT;
        return { activeRepo: typeof raw.activeRepo === "string" ? raw.activeRepo : null, port };
    } catch{
        return { activeRepo: null, port: DEFAULT_PORT };   // missing or unreadable: nothing chosen yet
    }
}

export function writeConfig(config: NebulosityConfig): void {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n");
}
