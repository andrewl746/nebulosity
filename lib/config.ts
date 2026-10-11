import fs from "fs";
import path from "path";
import { nebulosityPath } from "./home";

/** Small user-level settings that outlive any one run. */
export type NebulosityConfig = { activeRepo: string | null };

const configFile = (): string => nebulosityPath(".nebulosity", "config.json");

export function readConfig(): NebulosityConfig {
    try{
        const raw = JSON.parse(fs.readFileSync(configFile(), "utf8")) as { activeRepo?: unknown };
        return { activeRepo: typeof raw.activeRepo === "string" ? raw.activeRepo : null };
    } catch{
        return { activeRepo: null };   // missing or unreadable: nothing chosen yet
    }
}

export function writeConfig(config: NebulosityConfig): void {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n");
}
