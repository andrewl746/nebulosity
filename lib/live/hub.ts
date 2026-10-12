import type { LiveEvent } from "../contracts";

export type LiveListener = (event: LiveEvent) => void;

/** At most this many events a second reach the open Maps, so a runaway agent can't flood a browser tab. */
export const MAX_EVENTS_PER_SECOND = 20;

type Hub = { listeners: Set<LiveListener>; sentAt: number[] };

// on globalThis so a hot reload in development keeps the Maps already listening
const globalForHub = globalThis as unknown as { nebulosityLiveHub?: Hub };
const hub: Hub = (globalForHub.nebulosityLiveHub ??= { listeners: new Set(), sentAt: [] });

/** Starts handing live events to `listener` (one per open Map); returns the function that stops it. */
export function subscribe(listener: LiveListener): () => void {
    hub.listeners.add(listener);
    return () => { hub.listeners.delete(listener); };
}

/**
 * Hands an event to every open Map (PIVOT_SPEC.md §8). False when it was dropped for the rate limit. A listener
 * that throws (its stream has closed) is dropped, and the rest still get the event.
 */
export function publish(event: LiveEvent, now: number = Date.now()): boolean {
    hub.sentAt = hub.sentAt.filter((t) => now - t < 1000);
    if (hub.sentAt.length >= MAX_EVENTS_PER_SECOND) return false;
    hub.sentAt.push(now);

    for (const listener of [...hub.listeners]){
        try{
            listener(event);
        } catch{
            hub.listeners.delete(listener);
        }
    }
    return true;
}
