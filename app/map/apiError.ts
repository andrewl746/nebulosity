import type { ErrorCode } from "@/lib/contracts";

/** A request that failed: the server's error code, or NETWORK when no answer came back at all. */
export class ApiError extends Error {
    constructor(readonly status: number, readonly code: ErrorCode | "NETWORK", message: string){
        super(message);
        this.name = "ApiError";
    }
}
