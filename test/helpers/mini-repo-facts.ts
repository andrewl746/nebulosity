import type { FileFacts, FolderFacts } from "../../lib/db/store/summaries";

/**
 * The mini-repo fixture as the summary planner sees it, derived by hand. Line counts come
 * from the files themselves, importers from the 11 edges in the V1.1 plan's ground truth.
 * Content hashes are stand-ins; a test that "edits" a file changes its hash.
 */
export const FILES: FileFacts[] = [
    { path: "scripts/build.js", contentHash: "h-build", lineCount: 3, isTest: false, importedBy: 0 },
    { path: "src/app/main.ts", contentHash: "h-main", lineCount: 8, isTest: false, importedBy: 3 },
    { path: "src/app/view.tsx", contentHash: "h-view", lineCount: 11, isTest: false, importedBy: 1 },
    { path: "src/core/index.ts", contentHash: "h-core-index", lineCount: 1, isTest: false, importedBy: 1 },
    { path: "src/core/log.ts", contentHash: "h-log", lineCount: 9, isTest: false, importedBy: 3 },
    { path: "src/index.ts", contentHash: "h-index", lineCount: 7, isTest: false, importedBy: 1 },
    { path: "src/util/strings.test.ts", contentHash: "h-test", lineCount: 3, isTest: true, importedBy: 0 },
    { path: "src/util/strings.ts", contentHash: "h-strings", lineCount: 6, isTest: false, importedBy: 2 },
];

export const FOLDERS: FolderFacts[] = [
    { path: "", parentPath: null, depth: 0, name: "mini-repo", fileCount: 8, directFileCount: 0 },
    { path: "scripts", parentPath: "", depth: 1, name: "scripts", fileCount: 1, directFileCount: 1 },
    { path: "src", parentPath: "", depth: 1, name: "src", fileCount: 7, directFileCount: 1 },
    { path: "src/app", parentPath: "src", depth: 2, name: "app", fileCount: 2, directFileCount: 2 },
    { path: "src/core", parentPath: "src", depth: 2, name: "core", fileCount: 2, directFileCount: 2 },
    { path: "src/util", parentPath: "src", depth: 2, name: "util", fileCount: 2, directFileCount: 2 },
];
