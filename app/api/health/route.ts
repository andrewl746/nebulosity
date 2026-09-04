import { getLastScanAt } from "@/lib/db/graph-store";
import { getIndexStatus } from "@/lib/index-status";
import type { HealthResponse } from "@/lib/contracts";

// checks the overall condition of the server
export function GET(){
    const repoRoot = process.cwd();
    const lastScanAt = getLastScanAt(repoRoot);

    const health: HealthResponse = {
        ok: true,
        index: getIndexStatus(repoRoot),
        scannerEngine: "node",
        agentReady: Boolean(process.env.ANTHROPIC_API_KEY),
        lastScanAt: lastScanAt ? lastScanAt.toISOString() : null
    }

    return Response.json(health);
}
