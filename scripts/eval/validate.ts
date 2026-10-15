/** Each run is checked against D3, not trusted (R13): its init message before it counts, its result for notes. */
import type { Arm } from "./run-config";
import type { RunSummary } from "./transcript";

const REQUIRED_TOOLS = ["Bash", "Read", "Grep", "Glob"];
const FORBIDDEN_TOOLS = ["WebFetch", "WebSearch", "Skill", "PowerShell", "Edit", "Write"];
/** With scripts allowed (Eval #2), Edit and Write are expected (the permission rule limits them to the scratch folder); the web, skills and PowerShell stay refused. */
const REQUIRED_WITH_SCRIPTS = [...REQUIRED_TOOLS, "Edit", "Write"];
const FORBIDDEN_WITH_SCRIPTS = ["WebFetch", "WebSearch", "Skill", "PowerShell", "NotebookEdit"];

export function validateInit(run: RunSummary, expect: { arm: Arm; model: string; claudeVersion: string; forbiddenPlugins: readonly string[]; scripts: boolean }): string[] {
    const problems: string[] = [];
    if (run.model !== expect.model) problems.push(`model is ${run.model}, not ${expect.model}`);
    if (run.claudeVersion !== expect.claudeVersion) problems.push(`Claude Code is ${run.claudeVersion}, not ${expect.claudeVersion}`);
    if (run.permissionMode !== "dontAsk") problems.push(`permission mode is ${run.permissionMode}, not dontAsk`);
    if (run.apiKeySource !== null && run.apiKeySource !== "none") problems.push(`an API key is in use (${run.apiKeySource}), not the subscription`);
    const servers = run.mcpServers.map((s) => `${s.name}:${s.status}`);
    const wanted = expect.arm === "nebulosity" ? ["nebulosity:connected"] : [];
    if (servers.join(",") !== wanted.join(",")) problems.push(`MCP servers are [${servers.join(", ")}], not [${wanted.join(", ")}]`);
    for (const plugin of run.plugins) if (expect.forbiddenPlugins.includes(plugin)) problems.push(`the owner's plugin ${plugin} is loaded`);
    for (const tool of expect.scripts ? REQUIRED_WITH_SCRIPTS : REQUIRED_TOOLS) if (!run.tools.includes(tool)) problems.push(`${tool} is missing`);
    for (const tool of expect.scripts ? FORBIDDEN_WITH_SCRIPTS : FORBIDDEN_TOOLS) if (run.tools.includes(tool)) problems.push(`${tool} is present`);
    return problems;
}

/**
 * Why a raw transcript is an outage, not a result (R-R), or null: the API reported an error (a rate limit is one), the
 * run ended with no result line (killed, crashed, timed out), the final message is an error (Claude Code writes its own
 * API errors, such as "API Error: Connection error.", as a success with is_error and no status), or it never started
 * (no init message). Running out of turns or budget is an answer that scores 0, not an outage.
 */
export function infrastructureFailure(jsonl: string): string | null {
    let init = false;
    let result: { subtype?: unknown; is_error?: unknown; api_error_status?: unknown; result?: unknown } | undefined;
    for (const line of jsonl.split(/\r?\n/)){
        let event: { type?: unknown; subtype?: unknown; is_error?: unknown; api_error_status?: unknown; result?: unknown } | null;
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
    if (result.is_error === true && result.subtype === "success"){
        const text = typeof result.result === "string" ? result.result.trim().slice(0, 200) : "";
        return `the run ended on an error message, not an answer (${text || "no text"})`;
    }
    if (!init) return "the transcript has no init message";
    return null;
}

/**
 * The first line of a raw transcript, still being written or finished, that is the init message, or null while it
 * isn't all there. Only a complete line counts: JSON that parses as an object has all its braces, so a last line cut
 * short never matches. Lines before it (hook events) and lines that aren't JSON are skipped.
 */
export function firstInitLine(text: string): string | null {
    for (const line of text.split(/\r?\n/)){
        try{
            const event = JSON.parse(line) as { type?: unknown; subtype?: unknown } | null;
            if (event !== null && typeof event === "object" && event.type === "system" && event.subtype === "init") return line;
        } catch{
            // not JSON, or the line the child is writing now
        }
    }
    return null;
}

/** Things to report about a finished run, not to discard it for: another model answering (a fallback), an error ending. */
export function resultNotes(run: RunSummary, allowedModels: readonly string[]): string[] {
    const notes = Object.keys(run.models).filter((m) => !allowedModels.includes(m)).map((m) => `model ${m} also answered (a fallback?)`);
    if (run.subtype !== "success") notes.push(`ended with ${run.subtype}`);
    return notes;
}
