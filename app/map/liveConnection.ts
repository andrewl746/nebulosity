/**
 * Keeps one live stream open while the page is on screen (PIVOT_SPEC.md §8).
 *
 * Why this exists: when you leave a page, Chrome may keep it frozen in its back/forward cache so Back is instant, and a
 * frozen page's EventSource stays connected. Over plain HTTP/1.1 a browser allows only 6 connections to one server, so
 * after a handful of full page loads in one tab the frozen pages' streams held them all, and the next page's level,
 * status and repo requests waited forever (measured 2026-10-13: the 7th load stalled with the cache on, never with it
 * off). So the stream closes on `pagehide` and a new one opens on `pageshow` when the page comes back from the cache.
 */

/** What a stream must offer: a way to close it. EventSource has it; tests pass a stand-in. */
export type Closable = { close(): void };

/** Where pagehide and pageshow fire: the window, or a stand-in EventTarget in tests. */
type PageEvents = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Opens a stream now and keeps one open while the page shows; returns a function that closes it and stops listening. */
export function keepLiveStream(open: () => Closable, page: PageEvents): () => void {
    let stream: Closable | null = open();

    const onHide = (): void => {
        stream?.close();
        stream = null;
    };
    // pageshow fires on every load too; only a page restored from the cache (persisted) needs its stream back
    const onShow = (event: Event): void => {
        if ((event as PageTransitionEvent).persisted && stream === null) stream = open();
    };

    page.addEventListener("pagehide", onHide);
    page.addEventListener("pageshow", onShow);
    return () => {
        page.removeEventListener("pagehide", onHide);
        page.removeEventListener("pageshow", onShow);
        onHide();
    };
}
