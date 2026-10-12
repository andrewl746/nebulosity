import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const request = (host: string, route = "/api/level?path=") => new NextRequest(`http://${host}${route}`, { headers: { host } });

describe("proxy, in front of every API route", () => {
    it("refuses a request whose Host names another machine: a DNS-rebound page reading the index (I1)", async () => {
        const response = proxy(request("attacker.example:3000"));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: expect.any(String) } });
    });

    it("lets this machine's requests through, by any of its names", () => {
        for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]){
            expect(proxy(request(host, "/api/repos")).headers.get("x-middleware-next")).toBe("1");
        }
    });

    it("runs on the API routes, not the page", () => {
        expect(config.matcher).toBe("/api/:path*");
    });
});
