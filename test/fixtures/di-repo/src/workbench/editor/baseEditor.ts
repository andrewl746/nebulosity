import { IFileService } from "../../platform/files";

export abstract class BaseEditor {
    constructor(@IFileService protected readonly files: IFileService) {}
}
