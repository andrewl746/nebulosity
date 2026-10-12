import { NextRequest } from "next/server";
import { parseLiveEvent } from "@/lib/live/event";
import { publish } from "@/lib/live/hub";
import { isLocalRequest } from "@/lib/live/local";
import { forbidden, jsonError } from "../_lib/respond";

export const runtime = "nodejs";

// POST /api/live — a tool call to show on the open Maps; this machine only (API_CONTRACTS.md §14, ADR-039)
export async function POST(request: NextRequest){
    if (!isLocalRequest(request.headers)) return forbidden();
    const event = parseLiveEvent(await request.json().catch(() => null));
    if (event === null) return jsonError(400, "BAD_REQUEST", "Expected { tool, paths?, at?, action? }.");

    publish(event);
    return new Response(null, { status: 204 });
}
