import { configuredSummaryModels, type ResolvedSummaryModels } from "../lib/index/summarize/models";

/**
 * The summary models a real run would use (ADR-066): the defaults, or summaryModels in config.json. For the checkpoint
 * scripts, which send requests: a setting that can't be used ends the script with its message, before anything is sent.
 */
export function summaryModelsOrExit(label: string): ResolvedSummaryModels {
    const resolved = configuredSummaryModels();
    if (!resolved.ok){
        console.error(`[${label}] ${resolved.error}`);
        process.exit(1);
    }
    return resolved;
}
