import type { ServicesAccessor } from "../../platform/instantiation/instantiation";
import * as files from "../../platform/files/common/files";

export function openFile(accessor: ServicesAccessor, path: string): string {
    accessor.get(files.IFileService).writeFile(path, "");
    const service = accessor.get(files.IFileService);
    const optional = accessor.getOptional(files.IFileService);
    return service.readFile(path) + (optional ? optional.readFile(path) : "");
}

export function readAs(thing: unknown, path: string): string {
    return (thing as files.IFileService).readFile(path);
}
