import { NextResponse, type NextRequest } from "next/server";
import type { ErrorEnvelope } from "./lib/contracts";
import { isLocalHost } from "./lib/live/local";

/**
 * Runs before every API route (Next 16's proxy, formerly middleware). The server listens on loopback only, so a web
 * page can reach it through DNS rebinding alone, and such a page still sends its own host name. The read routes serve
 * the index (Claude-written summaries, the file tree, every indexed repo's root), so all of them answer only requests
 * addressed to this machine (ADR-039, amended). The routes that change things also check the Origin (isLocalRequest).
 */
export function proxy(request: NextRequest): NextResponse {
    if (isLocalHost(request.headers)) return NextResponse.next();
    return NextResponse.json<ErrorEnvelope>(
        { error: { code: "FORBIDDEN", message: "This server only answers requests addressed to this machine (localhost)." } },
        { status: 403 }
    );
}

export const config = { matcher: "/api/:path*" };
