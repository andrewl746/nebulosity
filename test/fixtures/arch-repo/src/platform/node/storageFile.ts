import { Storage } from "../common/storage";
import { readFile } from "../../base/node/fs";
import { TextModelHandle } from "../../editor/common/model";
import { log } from "@arch/core";

export function saveFile(text: string): Storage {
    log(readFile([text]));
    void TextModelHandle;
    return new Storage();
}
