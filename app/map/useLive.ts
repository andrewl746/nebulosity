"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "@/lib/contracts";

/**
 * The live channel (PIVOT_SPEC.md §8): every tool call from GET /api/live/stream. `onEvent` runs for each one (pulses,
 * UI actions), always the newest `onEvent` passed in; `last` is the newest event, for the dock. EventSource
 * reconnects by itself when the server restarts.
 */
export function useLive(onEvent: (event: LiveEvent) => void): { last: LiveEvent | null; connected: boolean } {
    const [last, setLast] = useState<LiveEvent | null>(null);
    const [connected, setConnected] = useState(false);
    const handler = useRef(onEvent);

    useEffect(() => {
        handler.current = onEvent;
    }, [onEvent]);

    useEffect(() => {
        const source = new EventSource("/api/live/stream");
        source.addEventListener("ready", () => setConnected(true));
        source.addEventListener("error", () => setConnected(false));
        source.addEventListener("tool", (message) => {
            const event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
            setLast(event);
            handler.current(event);
        });
        return () => source.close();
    }, []);

    return { last, connected };
}
