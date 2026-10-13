import { describe, expect, it } from "vitest";
import { keepLiveStream } from "./liveConnection";

/** A page stand-in (pagehide / pageshow fire on window) and a stream opener that records every stream it opens. */
function setup(){
    const page = new EventTarget();
    const streams: { closed: boolean }[] = [];
    const open = () => {
        const stream = { closed: false, close(){ this.closed = true; } };
        streams.push(stream);
        return stream;
    };
    const show = (persisted: boolean) => page.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
    return { page, streams, open, show };
}

describe("keepLiveStream (the Map stalled after ~7 page loads: frozen pages kept their streams)", () => {
    it("opens one stream at once", () => {
        const { page, streams, open } = setup();
        keepLiveStream(open, page);
        expect(streams.map((s) => s.closed)).toEqual([false]);
    });

    it("closes the stream when the page is put away, so a page frozen for Back holds no connection", () => {
        const { page, streams, open } = setup();
        keepLiveStream(open, page);
        page.dispatchEvent(new Event("pagehide"));
        expect(streams.map((s) => s.closed)).toEqual([true]);
    });

    it("opens a new stream when the page comes back from the back/forward cache", () => {
        const { page, streams, open, show } = setup();
        keepLiveStream(open, page);
        page.dispatchEvent(new Event("pagehide"));
        show(true);
        expect(streams.map((s) => s.closed)).toEqual([true, false]);
    });

    it("doesn't open a second stream on the first pageshow of a fresh load, or one already open", () => {
        const { page, streams, open, show } = setup();
        keepLiveStream(open, page);
        show(false);              // every load fires pageshow once, not from the cache
        show(true);               // and a stray restore while the stream is still open changes nothing
        expect(streams.length).toBe(1);
    });

    it("closes the stream and stops listening when the Map lets go of it", () => {
        const { page, streams, open, show } = setup();
        const stop = keepLiveStream(open, page);
        stop();
        page.dispatchEvent(new Event("pagehide"));
        show(true);
        expect(streams.map((s) => s.closed)).toEqual([true]);
    });
});
