import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./local";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe("isLocalRequest", () => {
    it("takes requests to this machine from programs and from the Map's own page, and nothing else", () => {
        expect(isLocalRequest(headers({ host: "localhost:3000" }))).toBe(true);
        expect(isLocalRequest(headers({ host: "127.0.0.1:3000" }))).toBe(true);
        expect(isLocalRequest(headers({ host: "[::1]:3000" }))).toBe(true);
        expect(isLocalRequest(headers({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
        expect(isLocalRequest(headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:4000" }))).toBe(true);

        expect(isLocalRequest(headers({}))).toBe(false);                                                        // no Host at all
        expect(isLocalRequest(headers({ host: "evil.example:3000" }))).toBe(false);                             // DNS rebinding
        expect(isLocalRequest(headers({ host: "192.168.1.20:3000" }))).toBe(false);                             // another machine
        expect(isLocalRequest(headers({ host: "localhost:3000", origin: "https://evil.example" }))).toBe(false); // another site's page
        expect(isLocalRequest(headers({ host: "localhost:3000", origin: "null" }))).toBe(false);                // a sandboxed or file:// page
    });
});
