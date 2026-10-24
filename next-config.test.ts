import { afterEach, describe, expect, it, vi } from "vitest";

// next.config.ts reads NEBULOSITY_DEMO when it loads, so each test sets the environment and imports a fresh copy
async function loadConfig(demo: boolean) {
    vi.resetModules();
    if (demo) vi.stubEnv("NEBULOSITY_DEMO", "1");
    else vi.stubEnv("NEBULOSITY_DEMO", undefined);
    return import("./next.config");
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("next.config.ts", () => {
    it("the Map's pages may be framed only by itself and VS Code", async () => {
        // the spike's recorded value (V1.8 ledger, "## Spike"): the VS Code extension frames the Map in a webview
        const { default: nextConfig, FRAME_ANCESTORS } = await loadConfig(false);
        expect(FRAME_ANCESTORS).toBe("frame-ancestors 'self' vscode-webview: vscode-file:");
        expect(await nextConfig.headers?.()).toEqual([
            { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: FRAME_ANCESTORS }] },
        ]);
    });

    it("sets no headers on the static demo, whose output: export can't have them", async () => {
        const { default: nextConfig } = await loadConfig(true);
        expect(nextConfig.output).toBe("export");
        expect(nextConfig.headers).toBeUndefined();
    });
});
