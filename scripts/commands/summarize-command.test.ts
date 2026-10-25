import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../../lib/db/client";
import { requireRepository } from "../../lib/db/store/structure";
import { summariesConfirmed } from "../../lib/db/store/summaries";
import { dataDir } from "../../lib/home";
import { repoKey } from "../../lib/index/paths";
import { indexRepository } from "../../lib/index/pipeline";
import type { Summarizer } from "../../lib/index/summarize/types";
import { runSummarize } from "./summarize-command";

// No request is ever made: the client is the test stub, the key is a fake, the .env.local file isn't read, and the
// embedding model isn't loaded.
const stub = stubSummarizer();
let summarizer: Summarizer | null = stub.summarizer;
vi.mock("../../lib/index/summarize/claude", () => ({ summarizerFromEnv: () => summarizer }));
vi.mock("../env", () => ({ loadLocalEnv: () => {}, hasAnthropicKey: () => summarizer !== null }));
vi.mock("../../lib/index/embed", () => ({ embedSummaries: async () => ({ embedded: 0, total: 0, remaining: 0 }) }));

const printed = (spy: { mock: { calls: unknown[][] } }): string => spy.mock.calls.map((call) => String(call[0])).join("\n");

// Each test has a data folder of its own, so the config.json it reads (summaryModels) is only ever the one it writes
const savedData = process.env.NEBULOSITY_DATA;
let dataFolder = "";

beforeEach(() => {
    summarizer = stub.summarizer;
    stub.requests.length = 0;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });   // no terminal
    dataFolder = fs.mkdtempSync(path.join(os.tmpdir(), "neb-summarize-data-"));
    process.env.NEBULOSITY_DATA = dataFolder;
});

afterEach(() => {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
    vi.restoreAllMocks();
    if (savedData === undefined) delete process.env.NEBULOSITY_DATA;
    else process.env.NEBULOSITY_DATA = savedData;
    fs.rmSync(dataFolder, { recursive: true, force: true });
});

/** Writes this test's config.json with the given summaryModels. */
function setSummaryModels(summaryModels: unknown): string {
    const file = path.join(dataFolder, "config.json");
    fs.writeFileSync(file, JSON.stringify({ activeRepo: null, port: 3000, summaryModels }));
    return file;
}

describe("nebulosity summarize: an estimate and a yes before any spend (S11)", () => {
    it("with a key and no terminal, prints the estimate, refuses without --yes, and sends nothing", async () => {
        const root = copyFixture();
        indexRepository(root);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await runSummarize([root, "--direct"])).toBe(1);

        // 13 requests: 7 files to Haiku, 5 folders and the repo to Sonnet; direct: 7 × 0.00059 + 6 × 0.0045 = $0.03113 at ASSUMED_TOKENS
        expect(printed(log)).toContain("about 13 requests (7 files to claude-haiku-5-5, 5 folders and the repo to claude-sonnet-5-5), about $0.0311 at list prices.");
        expect(printed(log)).toContain("Writing summaries sends each file's code to Anthropic.");
        expect(printed(error)).toContain("--yes");
        expect(stub.requests).toHaveLength(0);
        const db = getDb();
        expect(summariesConfirmed(db, requireRepository(db, repoKey(root)))).toBe(false);
    });

    it("with --yes, records the yes and goes on", async () => {
        const root = copyFixture();
        indexRepository(root);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        expect(await runSummarize([root, "--direct", "--yes"])).toBe(0);

        expect(stub.requests).toHaveLength(13);
        const db = getDb();
        expect(summariesConfirmed(db, requireRepository(db, repoKey(root)))).toBe(true);
    });

    it("with no key, says summaries need one and sends nothing", async () => {
        summarizer = null;
        const root = copyFixture();
        indexRepository(root);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        expect(await runSummarize([root])).toBe(0);

        expect(printed(log)).toContain(`ANTHROPIC_API_KEY is not set: writing test-file templates only (summaries need a key: set it in the environment, or put it in ${path.join(dataDir(), ".env.local")}).`);
        expect(printed(log)).not.toContain("at list prices");
        expect(stub.requests).toHaveLength(0);
    });
});

describe("nebulosity summarize: the models in summaryModels (ADR-066)", () => {
    it("refuses a model the table doesn't price when its prices are missing, before the estimate, and sends nothing (Review Focus 3)", async () => {
        const root = copyFixture();
        indexRepository(root);
        const file = setSummaryModels({ file: { model: "claude-zeta-1" } });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await runSummarize([root, "--direct", "--yes"])).toBe(1);

        expect(printed(error)).toContain("summaryModels.file.inputPerMTok");
        expect(printed(error)).toContain(file);
        expect(printed(log)).not.toContain("at list prices");
        expect(stub.requests).toHaveLength(0);
        const db = getDb();
        expect(summariesConfirmed(db, requireRepository(db, repoKey(root)))).toBe(false);
    });

    it("estimates with the set model and its prices", async () => {
        const root = copyFixture();
        indexRepository(root);
        setSummaryModels({ file: { model: "claude-haiku-6", inputPerMTok: 1, outputPerMTok: 5 } });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await runSummarize([root, "--direct"])).toBe(1);   // no terminal and no --yes: the estimate, then nothing sent

        // at ASSUMED_TOKENS, direct: 7 files × (4,600 × $1 + 260 × $5) / 1M = $0.0413, and 6 × Sonnet's $0.0045 = $0.027: $0.0683
        expect(printed(log)).toContain("about 13 requests (7 files to claude-haiku-6, 5 folders and the repo to claude-sonnet-5-5), about $0.0683 at list prices.");
        expect(stub.requests).toHaveLength(0);
    });

    it("stops at a model the API no longer serves with one message: the model, the config file and the README's section", async () => {
        const root = copyFixture();
        indexRepository(root);
        const sent: string[] = [];
        summarizer = {
            ...stub.summarizer,
            // what createClaudeSummarizer makes of the API's 404 "model: <id>"
            async summarize(request){
                sent.push(request.model);
                return {
                    customId: request.customId, ok: false, error: `API error 404: model: ${request.model}`, model: null, usage: null,
                    modelUnavailable: { model: request.model, reason: `model: ${request.model}` },
                };
            },
        };
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await runSummarize([root, "--direct", "--yes"])).toBe(1);

        const message = printed(error);
        expect(message).toContain("claude-haiku-5-5");
        expect(message).toContain(path.join(dataFolder, "config.json"));
        expect(message).toContain("Summary models");
        expect(error).toHaveBeenCalledTimes(1);
        expect(sent).toHaveLength(4);   // the four already on their way at once; the other three files never go
    });
});
