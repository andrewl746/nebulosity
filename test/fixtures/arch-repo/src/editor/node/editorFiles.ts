import { TextModel } from "../common/textModel";
import { readFile } from "../../base/node/fs";
import { saveFile } from "../../platform/node/storageFile";

export function openFiles(paths: string[]): TextModel {
    saveFile(readFile(paths));
    return new TextModel(null);
}
