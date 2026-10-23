import type { Framework } from "@di/infra";
import { DialogService } from "./dialogService";
import { Logger } from "../../platform/log/logger";

export function configureDialogs(framework: Framework): void {
    framework.service(DialogService, [Logger]);
}

export { DialogService };
