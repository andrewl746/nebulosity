/** Each run is checked against D3, not trusted (R13): its init message before it counts, its result for notes. */
import type { Arm } from "./run-config";
import type { RunSummary } from "./transcript";

const REQUIRED_TOOLS = ["Bash", "Read", "Grep", "Glob"];
const FORBIDDEN_TOOLS = ["WebFetch", "WebSearch", "Skill", "PowerShell", "Edit", "Write"];

export function validateInit(run: RunSummary, expect: { arm: Arm; model: string; forbiddenPlugins: readonly string[] }): string[] {
    const problems: string[] = [];
    if (run.model !== expect.model) problems.push(`model is ${run.model}, not ${expect.model}`);
    if (run.permissionMode !== "dontAsk") problems.push(`permission mode is ${run.permissionMode}, not dontAsk`);
    if (run.apiKeySource !== null && run.apiKeySource !== "none") problems.push(`an API key is in use (${run.apiKeySource}), not the subscription`);
    const servers = run.mcpServers.map((s) => `${s.name}:${s.status}`);
    const wanted = expect.arm === "nebulosity" ? ["nebulosity:connected"] : [];
    if (servers.join(",") !== wanted.join(",")) problems.push(`MCP servers are [${servers.join(", ")}], not [${wanted.join(", ")}]`);
    for (const plugin of run.plugins) if (expect.forbiddenPlugins.includes(plugin)) problems.push(`the owner's plugin ${plugin} is loaded`);
    for (const tool of REQUIRED_TOOLS) if (!run.tools.includes(tool)) problems.push(`${tool} is missing`);
    for (const tool of FORBIDDEN_TOOLS) if (run.tools.includes(tool)) problems.push(`${tool} is present`);
    return problems;
}

/**
 * Why a raw transcript is an outage, not a result (R-R), or null: the API reported an error (a rate limit is one), the
 * run ended with no result line (killed, crashed, timed out), or it never started (no init message). Running out of
 * turns or budget is an answer that scores 0, not an outage.
 */
export function infrastructureFailure(jsonl: string): string | null {
    let init = false;
    let result: { api_error_status?: unknown } | undefined;
    for (const line of jsonl.split(/\r?\n/)){
        let event: { type?: unknown; subtype?: unknown; api_error_status?: unknown } | null;
        try{
            event = JSON.parse(line) as typeof event;
        } catch{
            continue;   // a partial or non-JSON line
        }
        if (event === null || typeof event !== "object") continue;
        if (event.type === "system" && event.subtype === "init") init = true;
        if (event.type === "result") result = event;
    }
    if (result?.api_error_status != null){
        const status = result.api_error_status;
        return `the API returned an error (${typeof status === "string" ? status : JSON.stringify(status)})`;
    }
    if (result === undefined) return "the transcript has no result line (the run was killed, crashed or timed out)";
    if (!init) return "the transcript has no init message";
    return null;
}

/** Things to report about a finished run, not to discard it for: another model answering (a fallback), an error ending. */
export function resultNotes(run: RunSummary, allowedModels: readonly string[]): string[] {
    const notes = Object.keys(run.models).filter((m) => !allowedModels.includes(m)).map((m) => `model ${m} also answered (a fallback?)`);
    if (run.subtype !== "success") notes.push(`ended with ${run.subtype}`);
    return notes;
}
