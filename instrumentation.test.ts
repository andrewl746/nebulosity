import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "./test/helpers/temp";
import { register } from "./instrumentation";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("the Map server's start (instrumentation.ts)", () => {
    it("reads ANTHROPIC_API_KEY from the data folder's .env.local, as the CLI and the background worker do", async () => {
        // an installed copy keeps the key in the user's data folder; Next reads only its own folder's .env.local
        const data = makeTempDir("neb-data-");
        fs.writeFileSync(path.join(data, ".env.local"), "ANTHROPIC_API_KEY=sk-ant-test-from-the-data-folder\n");
        vi.stubEnv("NEXT_RUNTIME", "nodejs");
        vi.stubEnv("NEBULOSITY_WORKER", "off");                  // starts no worker
        vi.stubEnv("NEBULOSITY_HOME", makeTempDir("neb-home-"));  // a package folder with no .env.local
        vi.stubEnv("NEBULOSITY_DATA", data);
        vi.stubEnv("ANTHROPIC_API_KEY", undefined);

        await register();

        expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test-from-the-data-folder");
    });
});
