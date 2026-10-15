import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { getDb } from "../../lib/db/client";
import { requireRepository } from "../../lib/db/store/structure";
import { summariesConfirmed } from "../../lib/db/store/summaries";
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

beforeEach(() => {
    summarizer = stub.summarizer;
    stub.requests.length = 0;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });   // no terminal
});

afterEach(() => {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
    vi.restoreAllMocks();
});

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

        expect(printed(log)).toContain("ANTHROPIC_API_KEY is not set");
        expect(printed(log)).not.toContain("at list prices");
        expect(stub.requests).toHaveLength(0);
    });
});
