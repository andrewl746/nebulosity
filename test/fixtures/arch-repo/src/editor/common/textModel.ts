import type { TextModelHandle } from "./model";
import { trim } from "../../base/common/strings";

export class TextModel {
    constructor(readonly handle: TextModelHandle | null, readonly text = trim("")) {}
}
