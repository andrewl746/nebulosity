import { createDecorator } from "../../instantiation/instantiation";

export const IFileService = createDecorator<IFileService>("fileService");

export interface IFileService {
    readFile(path: string): string;
    writeFile(path: string, text: string): void;
}

export const IWatchingFileService = createDecorator<IWatchingFileService>("watchingFileService");

export interface IWatchingFileService extends IFileService {
    watch(path: string): void;
}
