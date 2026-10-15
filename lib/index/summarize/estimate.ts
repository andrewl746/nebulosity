import type { UsageRow } from "../../db/store/summaries";
import { projectSpend, type ProjectedRequest } from "./budget";

/** What a run would spend, before it sends anything (S11, ADR-035 amended): each request priced as the spend cap prices it. */
export function estimateSpend(requests: readonly ProjectedRequest[], usage: readonly UsageRow[], transport: "direct" | "batch"): { requests: number; usd: number; unpriced: string[] } {
    const p = projectSpend({ usage, baseline: usage, atAnthropic: [], thisSubmission: requests, thisTransport: transport, rest: [], restTransport: transport });
    return { requests: requests.length, usd: p.thisSubmission, unpriced: p.unpriced };
}
