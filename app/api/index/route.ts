// Rewritten in Task 15 onto the background worker (POST /api/index, API_CONTRACTS.md §4).
export function POST(){
    return Response.json({ error: { code: "INTERNAL", message: "Re-indexing over HTTP is being rebuilt (V1.3, Task 15)." } }, { status: 501 });
}
