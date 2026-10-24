import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test/helpers/temp";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("serverInfo (API_CONTRACTS §15)", () => {
    it("names the package's version and the editor bridge's, 1", async () => {
        const home = makeTempDir("neb-server-info-");
        fs.writeFileSync(path.join(home, "package.json"), JSON.stringify({ name: "nebulosity", version: "9.8.7" }));
        vi.stubEnv("NEBULOSITY_HOME", home);
        vi.resetModules();   // the version is read once, when the module first answers

        const { serverInfo } = await import("./server");
        expect(serverInfo()).toEqual({ version: "9.8.7", bridge: 1 });

        // read once: a package.json that changes underneath a running server isn't read again
        fs.writeFileSync(path.join(home, "package.json"), JSON.stringify({ name: "nebulosity", version: "1.0.0" }));
        expect(serverInfo().version).toBe("9.8.7");
    });
});
