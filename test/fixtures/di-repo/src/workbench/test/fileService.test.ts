import { IFileService } from "../../platform/files/common/files";
import { FileService } from "../../platform/files/common/fileService";
import { DisposableStore } from "../../base/lifecycle";
import { mock } from "../../base/test/mock";

class TestFileService extends mock<IFileService>() {
    override readFile(path: string): string {
        return `test:${path}`;
    }
}

export function check(store: DisposableStore): string {
    const real = store.add(new FileService());
    return real.readFile("a") + new TestFileService().readFile("b");
}
