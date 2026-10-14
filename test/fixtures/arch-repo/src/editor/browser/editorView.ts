import { TextModelHandle } from "../common/model";
import { el } from "../../base/browser/dom";

export class EditorView {
    readonly root = el("div");
    constructor(readonly model: TextModelHandle) {}
}
