/**
 * npm run live -- <tool> [path ...] [--highlight | --focus | --clear]
 *
 * Sends one live event to the open Map, as V1.4's MCP tools will (PIVOT_SPEC.md §8). The boxes holding the paths
 * pulse. --highlight, --focus or --clear also sends that UI action, which is what show_on_map sends. For trying the
 * Map by hand.
 */
import type { LiveEvent, UIAction } from "../lib/contracts";
import { postLiveEvent } from "../lib/live/client";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [tool, ...paths] = args.filter((a) => !a.startsWith("--"));
const ACTIONS = ["--highlight", "--focus", "--clear"];

if (!tool || flags.length > 1 || flags.some((f) => !ACTIONS.includes(f)) || (flags[0] === "--focus" && paths.length !== 1)){
    console.error("usage: npm run live -- <tool> [path ...] [--highlight | --focus | --clear]");
    process.exit(1);
}

const action: UIAction | undefined =
    flags[0] === "--highlight" ? { type: "highlight_nodes", nodeIds: paths }
    : flags[0] === "--focus" ? { type: "focus_node", nodeId: paths[0] }
    : flags[0] === "--clear" ? { type: "clear_highlights" }
    : undefined;
const event: LiveEvent = { tool, paths, at: new Date().toISOString(), ...(action ? { action } : {}) };

postLiveEvent(event, { timeoutMs: 2_000 }).then((ok) => {
    console.log(ok ? `[live] sent ${tool} (${paths.length} paths)` : "[live] no Map server answered on the configured port; is npm run dev running?");
    process.exit(ok ? 0 : 1);
});
