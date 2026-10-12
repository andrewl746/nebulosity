"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "@/lib/contracts";
import { pushActivity } from "./activity";

/**
 * The live channel (PIVOT_SPEC.md §8): every tool call from GET /api/live/stream. `onEvent` runs for each one (pulses,
 * UI actions), always the newest `onEvent` passed in; `recent` is the last 3, newest first, for the activity bar
 * (VISUAL_REFRESH.md §6). EventSource reconnects by itself when the server restarts.
 */
export function useLive(onEvent: (event: LiveEvent) => void): { recent: LiveEvent[]; connected: boolean } {
    const [recent, setRecent] = useState<LiveEvent[]>([]);
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
            setRecent((r) => pushActivity(r, event));
            handler.current(event);
        });
        return () => source.close();
    }, []);

    return { recent, connected };
}
