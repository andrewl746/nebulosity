import { getLastScanAt } from "@/lib/db/graph-store";
import type { HealthResponse } from "@/lib/contracts";

// checks the overall condition of the server
export function GET(){
    const lastScanAt = getLastScanAt(process.cwd());

    const health: HealthResponse = {
        ok: true,
        index: {
            exists: false,
            indexedAt: null,
            chunkCount: 0,
            staleFiles: 0
        },
        scannerEngine: "node",
        agentReady: Boolean(process.env.ANTHROPIC_API_KEY),
        lastScanAt: lastScanAt ? lastScanAt.toISOString() : null
    }
    
    return Response.json(health);
}
