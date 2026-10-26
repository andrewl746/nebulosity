import { describe, expect, it } from "vitest";
import { isDroppedConnection } from "./http";

/** What Node's fetch rejects with when the socket fails: a TypeError whose cause carries the socket's code. */
const fetchFailed = (code: unknown): TypeError => new TypeError("fetch failed", { cause: Object.assign(new Error("socket"), { code }) });

describe("isDroppedConnection (a connection the server dropped while it came up, PR #10 review 6)", () => {
    it("is a reset, a broken pipe, or one of undici's socket errors", () => {
        expect(isDroppedConnection(fetchFailed("ECONNRESET"))).toBe(true);
        expect(isDroppedConnection(fetchFailed("EPIPE"))).toBe(true);
        expect(isDroppedConnection(fetchFailed("UND_ERR_SOCKET"))).toBe(true);
        expect(isDroppedConnection(fetchFailed("UND_ERR_CLOSED"))).toBe(true);
        // a body cut off mid-read rejects response.text() the same way
        expect(isDroppedConnection(new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }))).toBe(true);
    });

    it("is not a refused connection, which has its own meaning (nothing listens), nor another failure", () => {
        expect(isDroppedConnection(fetchFailed("ECONNREFUSED"))).toBe(false);
        expect(isDroppedConnection(fetchFailed("ENOTFOUND"))).toBe(false);
        expect(isDroppedConnection(fetchFailed(54))).toBe(false);
        expect(isDroppedConnection(fetchFailed(undefined))).toBe(false);
        expect(isDroppedConnection(new TypeError("fetch failed"))).toBe(false);
        expect(isDroppedConnection(new TypeError("fetch failed", { cause: "ECONNRESET" }))).toBe(false);
    });

    it("is only fetch's TypeError, not any error that names the code", () => {
        expect(isDroppedConnection(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(false);
        expect(isDroppedConnection(new Error("fetch failed", { cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }) }))).toBe(false);
        expect(isDroppedConnection(null)).toBe(false);
        expect(isDroppedConnection("ECONNRESET")).toBe(false);
    });
});
