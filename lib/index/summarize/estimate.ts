import type { UsageRow } from "../../db/store/summaries";
import { projectSpend, type ProjectedRequest } from "./budget";
import type { PriceTable } from "./pricing";

/**
 * What a run would spend, before it sends anything (S11, ADR-035 amended): each request priced as the spend cap prices it,
 * at `prices` (the summary models setting's, ADR-066) before the built-in table.
 */
export function estimateSpend(
    requests: readonly ProjectedRequest[], usage: readonly UsageRow[], transport: "direct" | "batch", prices?: PriceTable
): { requests: number; usd: number; unpriced: string[] } {
    const p = projectSpend({ usage, baseline: usage, atAnthropic: [], thisSubmission: requests, thisTransport: transport, rest: [], restTransport: transport, prices });
    return { requests: requests.length, usd: p.thisSubmission, unpriced: p.unpriced };
}
