import type { HealthResponse } from "@/lib/contracts";

// checks the overall condition of the server
export function GET(){
    const health: HealthResponse = {
        ok: true,
        index: {
            exists: false,
            indexedAt: null,
            chunkCount: 0,
            staleFiles: 0
        },
        scannerEngine: "node",
        agentReady: Boolean(process.env.ANTHROPIC_API_KEY)
    }
    
    return Response.json(health);
}
