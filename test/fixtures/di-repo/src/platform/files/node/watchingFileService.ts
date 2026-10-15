import { IWatchingFileService } from "../common/files";
import { FileService } from "../common/fileService";

export class WatchingFileService extends FileService implements IWatchingFileService {
    watch(path: string): void {
        void this.readFile(path);
    }
}
