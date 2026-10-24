import type { LevelResponse, LiveEvent } from "@/lib/contracts";
import { boxFor } from "./paths";

/** The activity bar lists this many of Claude Code's tool calls (VISUAL_REFRESH.md §6). */
export const ACTIVITY_SIZE = 3;
/** A tool call counts as "right now" for this long: its boxes stay outlined in orange. */
export const AGENT_ACTIVE_MS = 30_000;

/** The activity after one more tool call: newest first, at most `size`. */
export function pushActivity(recent: readonly LiveEvent[], event: LiveEvent, size: number = ACTIVITY_SIZE): LiveEvent[] {
    return [event, ...recent].slice(0, size);
}

/** The activity bar's note on show_on_map's highlights, beside its Clear button: "3 highlighted"; null when there are none. */
export function highlightedNote(count: number): string | null {
    return count === 0 ? null : `${count.toLocaleString("en-US")} highlighted`;
}

/** The prefix Claude Code puts on an MCP server's tools (PIVOT_SPEC.md §6.2: mcp__nebulosity__<name>). */
const MCP_PREFIX = "mcp__nebulosity__";

/** The first path ("" is the repo), and how many more: "src/vs +2". */
function list(paths: readonly string[]): string {
    const first = paths[0] === "" ? "the repo" : paths[0];
    return paths.length > 1 ? `${first} +${paths.length - 1}` : first;
}

/**
 * A tool call in words, for the activity bar: "Reading build/gulpfile.js". One phrase per v1 tool (PIVOT_SPEC.md
 * §6.2); a tool it doesn't know is named as it is, with what it touched.
 */
export function activityLabel(event: LiveEvent): string {
    const tool = event.tool.startsWith(MCP_PREFIX) ? event.tool.slice(MCP_PREFIX.length) : event.tool;
    const { paths } = event;
    const any = paths.length > 0;
    switch (tool){
        case "describe": return any ? `Reading ${list(paths)}` : "Reading";
        case "overview": return "Reading the repo overview";
        case "search": return any ? `Searching · ${list(paths)}` : "Searching";
        // a live event carries only the tool and its paths, so a chain is told by having two or more
        case "imports": return paths.length >= 2 ? `Tracing ${paths[0]} → ${paths[1]}` : any ? `Following the imports of ${list(paths)}` : "Following imports";
        case "architecture": return any ? `Reading how ${list(paths)} is organized` : "Reading how the code is organized";
        case "calls": return any ? `Following the calls into ${list(paths)}` : "Following calls";
        case "show_on_map": return any ? `Showing ${list(paths)} on the map` : "Showing on the map";
        default: return any ? `${tool} · ${list(paths)}` : tool;
    }
}

/**
 * The boxes Claude Code is touching right now (VISUAL_REFRESH.md §4, Claude's focus): the boxes on this level that
 * hold what the recent tool calls touched in the last AGENT_ACTIVE_MS, plus show_on_map's highlights. A path on
 * another page lands on that page's portal; a path outside the level outlines nothing.
 */
export function agentFocus(
    level: Pick<LevelResponse, "path" | "nodes">,
    recent: readonly LiveEvent[],
    highlights: readonly string[],
    now: number,
    /** When the user last pressed Clear (or Esc): the calls made before it no longer count. */
    clearedAt: number = -Infinity,
): Set<string> {
    const touched = recent
        .filter((e) => {
            const at = Date.parse(e.at);
            return now - at < AGENT_ACTIVE_MS && at > clearedAt;
        })
        .flatMap((e) => e.paths);
    return new Set([...touched, ...highlights].flatMap((p) => boxFor(level, p) ?? []));
}
