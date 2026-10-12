import { z } from "zod";
import type { LiveEvent, UIAction } from "../contracts";
import { parseRepoPath } from "../index/paths";

const actionSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("highlight_nodes"), nodeIds: z.array(z.string().max(1024)).max(50) }),
    z.object({ type: z.literal("focus_node"), nodeId: z.string().max(1024) }),
    z.object({ type: z.literal("clear_highlights") }),
]);

const eventSchema = z.object({
    tool: z.string().trim().min(1).max(64),
    paths: z.array(z.string().max(1024)).max(50).default([]),
    at: z.string().max(64).optional(),
    action: actionSchema.optional(),
});

const repoPaths = (raw: readonly string[]): string[] => raw.map(parseRepoPath).filter((p): p is string => p !== null);

/**
 * A live event from outside (an MCP tool handler, npm run live), checked and normalized: repo-relative paths only (any
 * other is dropped), `at` filled in when missing. Null when the body isn't a live event, or names a focus target
 * outside the repo.
 */
export function parseLiveEvent(raw: unknown, now: Date = new Date()): LiveEvent | null {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) return null;

    let action: UIAction | undefined;
    const given = parsed.data.action;
    if (given?.type === "highlight_nodes") action = { type: "highlight_nodes", nodeIds: repoPaths(given.nodeIds) };
    else if (given?.type === "clear_highlights") action = { type: "clear_highlights" };
    else if (given?.type === "focus_node"){
        const nodeId = parseRepoPath(given.nodeId);
        if (nodeId === null) return null;
        action = { type: "focus_node", nodeId };
    }

    return { tool: parsed.data.tool, paths: repoPaths(parsed.data.paths), at: parsed.data.at ?? now.toISOString(), ...(action ? { action } : {}) };
}
