import type { IFileService } from "../common/files";

export class MemoryFileService implements IFileService {
    readFile(path: string): string {
        return path;
    }

    writeFile(path: string, text: string): void {
        void path;
        void text;
    }
}
