import { Logger } from "./logger";
import { Logger as PlatformLogger } from "../../platform/log/logger";

export function show(local: Logger, platform: PlatformLogger): void {
    local.log("a", 1);
    platform.log("b");
}
