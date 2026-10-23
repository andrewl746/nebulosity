import { FileService } from "../../platform/files/common/fileService";

function makeService() {
    return new FileService();
}

export function loadInferred(path: string): string {
    const inferred = makeService();
    return inferred.readFile(path);
}
