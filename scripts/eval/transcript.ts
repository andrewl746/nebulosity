/** A `claude -p --output-format stream-json --verbose` run, summarized for the eval's tables (D2's metrics). */
export type RunSummary = {
    model: string | null; claudeVersion: string | null; apiKeySource: string | null; permissionMode: string | null;
    tools: string[]; mcpServers: { name: string; status: string }[]; plugins: string[]; skills: number;
    finalText: string | null; subtype: string | null; isError: boolean; turns: number; durationMs: number; apiMs: number; costUsd: number;
    /** The main conversation's tokens (Claude Code reports subagents' only per model). */
    usage: { input: number; cacheWrite: number; cacheRead: number; output: number };
    /** The first API call's prompt: input + cache writes + cache reads of the first assistant message (the per-turn base, D1 condition 5). */
    firstCallContext: number | null;
    /** Every model's tokens and cost estimate, subagents and background calls included. */
    models: Record<string, { costUsd: number; input: number; output: number; cacheRead: number; cacheWrite: number }>;
    toolCalls: Record<string, number>; nestedToolCalls: Record<string, number>; toolErrors: number;
    toolSearchCalls: number; nebulosityCalls: number;
    /** The subscription's 5-hour and 7-day windows, from the last rate_limit_event (0 to 1). */
    utilization: { fiveHour: number | null; sevenDay: number | null };
};

type Json = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- stream-json lines are read field by field

const count = (into: Record<string, number>, name: string): void => { into[name] = (into[name] ?? 0) + 1; };

export function summarizeRun(jsonl: string): RunSummary {
    const events: Json[] = [];
    for (const line of jsonl.split(/\r?\n/)){
        try{
            const parsed = JSON.parse(line) as unknown;
            if (parsed !== null && typeof parsed === "object") events.push(parsed as Json);
        } catch{
            // a partial or non-JSON line: skipped
        }
    }
    const init = events.find((e) => e.type === "system" && e.subtype === "init") ?? {};
    const result = [...events].reverse().find((e) => e.type === "result") ?? {};
    const limits = [...events].reverse().find((e) => e.type === "rate_limit_event")?.rate_limit_info?.unifiedWindows ?? {};

    const toolCalls: Record<string, number> = {};
    const nestedToolCalls: Record<string, number> = {};
    let toolErrors = 0;
    for (const e of events){
        const content: Json[] = Array.isArray(e.message?.content) ? e.message.content : [];
        if (e.type === "assistant") for (const c of content) if (c.type === "tool_use") count(e.parent_tool_use_id ? nestedToolCalls : toolCalls, c.name);
        if (e.type === "user") toolErrors += content.filter((c) => c.type === "tool_result" && c.is_error === true).length;
    }
    const both = (pick: (name: string) => boolean): number =>
        [toolCalls, nestedToolCalls].reduce((sum, calls) => sum + Object.entries(calls).filter(([n]) => pick(n)).reduce((s, [, c]) => s + c, 0), 0);
    const usage = result.usage ?? {};
    const firstUsage = events.find((e) => e.type === "assistant" && e.message?.usage)?.message.usage as Json | undefined;
    const firstCallContext = firstUsage
        ? (firstUsage.input_tokens ?? 0) + (firstUsage.cache_creation_input_tokens ?? 0) + (firstUsage.cache_read_input_tokens ?? 0)
        : null;

    return {
        model: init.model ?? null, claudeVersion: init.claude_code_version ?? null, apiKeySource: init.apiKeySource ?? null, permissionMode: init.permissionMode ?? null,
        tools: init.tools ?? [],
        mcpServers: (init.mcp_servers ?? []).map((s: Json) => ({ name: s.name, status: s.status })),
        plugins: (init.plugins ?? []).map((p: Json | string) => (typeof p === "string" ? p : p.name)),
        skills: (init.skills ?? []).length,
        finalText: result.result ?? null, subtype: result.subtype ?? null, isError: result.is_error === true,
        turns: result.num_turns ?? 0, durationMs: result.duration_ms ?? 0, apiMs: result.duration_api_ms ?? 0, costUsd: result.total_cost_usd ?? 0,
        usage: { input: usage.input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, output: usage.output_tokens ?? 0 },
        firstCallContext,
        models: Object.fromEntries(Object.entries((result.modelUsage ?? {}) as Record<string, Json>).map(([model, m]) => [model, {
            costUsd: m.costUSD ?? 0, input: m.inputTokens ?? 0, output: m.outputTokens ?? 0, cacheRead: m.cacheReadInputTokens ?? 0, cacheWrite: m.cacheCreationInputTokens ?? 0,
        }])),
        toolCalls, nestedToolCalls, toolErrors,
        toolSearchCalls: both((n) => n === "ToolSearch"),
        nebulosityCalls: both((n) => n.startsWith("mcp__nebulosity__")),
        utilization: { fiveHour: limits.five_hour?.utilization ?? null, sevenDay: limits.seven_day?.utilization ?? null },
    };
}
