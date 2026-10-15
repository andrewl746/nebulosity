import { IFileService } from "./files";
import { registerSingleton } from "../../instantiation/instantiation";

export class FileService implements IFileService {
    readFile(path: string): string {
        return path;
    }

    writeFile(path: string, text: string): void {
        void this.readFile(path);
        void text;
    }
}

registerSingleton(IFileService, FileService);
