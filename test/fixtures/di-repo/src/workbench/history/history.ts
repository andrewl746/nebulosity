import type { IFileService } from "../../platform/files/common/files";

export function loadAll<T extends IFileService>(service: T, paths: string[]): string[] {
    return paths.map((p) => service.readFile(p));
}

export function loadOne({ files, path }: { files: IFileService; path: string }): string {
    return files.readFile(path);
}
