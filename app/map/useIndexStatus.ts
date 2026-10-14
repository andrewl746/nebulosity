"use client";

import { useCallback, useEffect, useState } from "react";
import type { IndexStatus } from "@/lib/contracts";
import { api, ApiError } from "./api";
import { DEMO } from "./mode";

/** How often the Map asks for the index status: the pill reads it, and `indexVersion` says when to refetch. */
export const STATUS_POLL_MS = 2_000;

/**
 * The active repo's index status, polled every 2 s and whenever the window regains focus. `error` is set while there's
 * no repo to show (INDEX_EMPTY) or the server can't be reached, and the last good status stays meanwhile. The static
 * demo reads it once: its index is frozen (ADR-049).
 */
export function useIndexStatus(): { status: IndexStatus | null; error: ApiError | null; refresh: () => void } {
    const [status, setStatus] = useState<IndexStatus | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        api.status(controller.signal).then(
            (next) => { setStatus(next); setError(null); },
            (err: unknown) => { if (err instanceof ApiError) setError(err); },
        );
        // the demo's status never changes, so it's read once
        const timer = DEMO ? null : setTimeout(() => setTick((t) => t + 1), STATUS_POLL_MS);
        return () => {
            controller.abort();
            if (timer !== null) clearTimeout(timer);
        };
    }, [tick]);

    useEffect(() => {
        if (DEMO) return;
        const onFocus = () => setTick((t) => t + 1);
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, []);

    const refresh = useCallback(() => setTick((t) => t + 1), []);
    return { status, error, refresh };
}
