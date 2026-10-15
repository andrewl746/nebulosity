import { IFileService, IWatchingFileService } from "../../platform/files/common/files";
import { Disposable } from "../../base/lifecycle";

export class EditorPane extends Disposable {
    constructor(
        @IFileService private readonly fileService: IFileService,
        @IWatchingFileService private readonly watcher: IWatchingFileService,
    ) {
        super();
    }

    load(path: string): string {
        const files = this.fileService;
        this.watcher.watch(path);
        return files.readFile(path) + this.watcher.readFile(path);
    }
}
