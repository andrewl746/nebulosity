import { BaseEditor } from "./baseEditor";

export class TextEditor extends BaseEditor {
    open(path: string): string {
        return this.files.readFile(path);
    }
}
