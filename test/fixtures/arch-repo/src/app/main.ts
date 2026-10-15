import { EditorView } from "../editor/browser/editorView";
import { saveFile } from "../platform/node/storageFile";
import { openFiles } from "../editor/node/editorFiles";
import { button } from "@arch/ui";
import React from "react";

export function main(): unknown {
    return [EditorView, saveFile, openFiles, button("Open"), React];
}
