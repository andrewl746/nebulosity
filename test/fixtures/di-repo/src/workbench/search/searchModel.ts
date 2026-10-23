import { Disposable } from "../../base/lifecycle";
import { DefaultFileService } from "../../platform/files";

export class SearchModel extends Disposable {
    private readonly reader = this._register(new DefaultFileService());

    search(path: string): string {
        return this.reader.readFile(path);
    }
}
