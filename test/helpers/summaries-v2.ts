import { eq } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { summaries } from "../../lib/db/schema";
import { loadFileFacts, loadFolderFacts, loadSummaries, targetKey } from "../../lib/db/store/summaries";
import { bumpIndexVersion } from "../../lib/db/store/version";
import { inputHash, planSummaries } from "../../lib/index/summarize/plan";
import { folderTier, joinParagraphs, lengthLine, SUMMARY_MODELS } from "../../lib/index/summarize/prompts";

/**
 * Makes a repo's summaries what Nebulosity 1.0 stored for the same input: every model-written row at prompt version 2,
 * its input hashed under version 2. 1.0 recorded no prompt version (P3), but it hashed the same inputs under version 2,
 * so the planner reads these rows as older style only (P1). A file's input is its path and content hash. A folder's and
 * the repo's is its prompt's body, the prompt less its length line, which 1.0 never sent (P2). That body is taken from
 * planSummaries as it renders it now, which is what 1.0 rendered while every summary is one paragraph, as the stub
 * summarizer writes them. Templates stay as they are.
 */
export function rewriteAsWrittenBy10(db: Db, repoId: number): void {
    const files = loadFileFacts(db, repoId);
    const folders = loadFolderFacts(db, repoId);
    const stored = loadSummaries(db, repoId);
    // a folder lists its children's summaries on one line each now, verbatim in 1.0, so the two agree only on one paragraph
    for (const row of stored){
        if (row.kind !== "repo" && row.summary !== null && joinParagraphs(row.summary) !== row.summary){
            throw new Error(`rewriteAsWrittenBy10: the summary of ${row.kind} "${row.path}" isn't one trimmed paragraph, so its folder's body isn't what 1.0 rendered`);
        }
    }
    const contentHashes = new Map(files.map((f) => [f.path, f.contentHash]));
    const fileCounts = new Map(folders.map((f) => [f.path, f.fileCount]));
    const prompts = new Map(planSummaries(files, folders, stored, { models: SUMMARY_MODELS, refreshStaleFolders: true, failedThisRun: new Set() })
        .map((t) => [targetKey(t.kind, t.path), t.prompt]));

    const bodyOf = (kind: "folder" | "repo", path: string): string => {
        const prompt = prompts.get(targetKey(kind, path)) ?? "";
        // stripped by its known text: a body can hold blank lines of its own
        const line = `\n\n${lengthLine(kind, kind === "repo" ? "large" : folderTier(fileCounts.get(path) ?? 0))}`;
        if (!prompt.endsWith(line)) throw new Error(`rewriteAsWrittenBy10: the prompt for ${kind} "${path}" doesn't end with its length line`);
        return prompt.slice(0, -line.length);
    };

    db.transaction((tx) => {
        for (const row of stored){
            if (!row.model || row.model === "template") continue;
            const input = row.kind === "file" ? `file\n${row.path}\n${contentHashes.get(row.path)}` : bodyOf(row.kind, row.path);
            tx.update(summaries).set({ promptVersion: 2, inputHash: inputHash(row.model, 2, input) }).where(eq(summaries.id, row.id)).run();
        }
    });
    // the rows changed under whatever cached them, as any write the Map shows does (ADR-036)
    bumpIndexVersion(db, repoId);
}
