import { useService, useServiceOptional, useServices } from "@di/infra";
import { DialogService } from "../dialogs";

export function SettingsButton(): null {
    const dialogs = useService(DialogService);
    dialogs.open("settings");
    useServiceOptional(DialogService)?.open("about");
    const { dialogService } = useServices({ DialogService });
    dialogService.open("help");
    return null;
}
