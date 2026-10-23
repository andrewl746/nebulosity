import { watching } from "../../platform/files";

export function watchAll(service: watching.WatchingFileService, paths: string[]): void {
    for (const path of paths) service.watch(path);
}
