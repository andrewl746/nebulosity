import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isolateDataFolder } from "../../test/helpers/data-folder";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { rewriteAsWrittenBy10 } from "../../test/helpers/summaries-v2";
import { getDb } from "../../lib/db/client";
import { readStages } from "../../lib/db/store/stages";
import { requireRepository } from "../../lib/db/store/structure";
import { approvedBudgetUsd, loadSummaries, summariesConfirmed } from "../../lib/db/store/summaries";
import { dataDir } from "../../lib/home";
import { repoKey } from "../../lib/index/paths";
import { indexRepository } from "../../lib/index/pipeline";
import { runSummaries } from "../../lib/index/summarize/run";
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

/** The estimate's line among what was logged, or "" when there was none. */
const estimateLine = (spy: { mock: { calls: unknown[][] } }): string =>
    spy.mock.calls.map((call) => String(call[0])).find((line) => line.includes(" at list prices")) ?? "";

/** `line`'s last `tail.length` characters, which a line ending with `tail` shows as `tail` itself. */
const ending = (line: string, tail: string): string => line.slice(Math.max(0, line.length - tail.length));

// Each test has a data folder of its own, so the config.json it reads (summaryModels) is only ever the one it writes
const dataFolder = isolateDataFolder();

beforeEach(() => {
    summarizer = stub.summarizer;
    stub.requests.length = 0;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });   // no terminal
});

afterEach(() => {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
    vi.restoreAllMocks();
});

/** Writes this test's config.json with the given summaryModels. */
function setSummaryModels(summaryModels: unknown): string {
    const file = path.join(dataFolder(), "config.json");
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

    // R24: the Map's automatic refreshes stop at the budget of the last yes
    it("records the budget the yes was given to: --budget's, else the default $15", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const db = getDb();

        const raised = copyFixture();
        indexRepository(raised);
        expect(await runSummarize([raised, "--direct", "--yes", "--budget", "30"])).toBe(0);
        expect(approvedBudgetUsd(db, requireRepository(db, repoKey(raised)))).toBe(30);

        const plain = copyFixture();
        indexRepository(plain);
        expect(await runSummarize([plain, "--direct", "--yes"])).toBe(0);
        expect(approvedBudgetUsd(db, requireRepository(db, repoKey(plain)))).toBe(15);
    });

    // Final Review #2, minor 3 (ruling R30): the worker's stop note says "--budget <usd> approves more", and the run that
    // follows it may find nothing waiting (the out-of-date summaries were opened on the Map meanwhile)
    it("with nothing waiting to be sent, still records the run's budget for a repo already said yes to", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const db = getDb();
        const root = copyFixture();
        indexRepository(root);
        expect(await runSummarize([root, "--direct", "--yes"])).toBe(0);
        const repoId = requireRepository(db, repoKey(root));
        expect(approvedBudgetUsd(db, repoId)).toBe(15);
        stub.requests.length = 0;

        // no --yes and no terminal: there's no spend to say yes to, only the budget the Map's refreshes keep to
        expect(await runSummarize([root, "--direct", "--budget", "25"])).toBe(0);
        expect(stub.requests).toHaveLength(0);
        expect(approvedBudgetUsd(db, repoId)).toBe(25);
        expect(printed(log)).toContain("[summarize] Nothing to send. The Map's automatic refreshes may now take this repo's summary spend up to $25.00 in all.");

        // a re-run without --budget records the default again (R24's "the last --budget a confirmed run used")
        expect(await runSummarize([root, "--direct"])).toBe(0);
        expect(approvedBudgetUsd(db, repoId)).toBe(15);
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

    // R24 (the final review's A-I1): before, this estimate was the 7 files alone, about $0.0041
    it("after a file model change, estimates the folders and the repo the new file summaries put out of date as well", async () => {
        const root = copyFixture();
        indexRepository(root);
        await runSummaries(root, { summarizer: stub.summarizer, transport: "direct" });   // every summary written at the defaults
        stub.requests.length = 0;
        setSummaryModels({ file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await runSummarize([root, "--direct"])).toBe(1);   // the estimate, then nothing sent

        // Direct. The 7 files to Haiku 6, which has no usage yet, at ASSUMED_TOKENS: 7 × (4,600 × $0.10 + 260 × $0.50) / 1M =
        // $0.00413. The 5 folders and the repo above them at Sonnet 5.5's recorded mean (the stub's 100 in, 20 out):
        // 6 × (100 × $2 + 20 × $10) / 1M = $0.0024. $0.00653 in all.
        expect(printed(log)).toContain("about 13 requests (7 files to claude-haiku-6, 5 folders and the repo to claude-sonnet-5-5), about $0.0065 at list prices.");
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
        expect(message).toContain(path.join(dataFolder(), "config.json"));
        expect(message).toContain("Summary models");
        expect(error).toHaveBeenCalledTimes(1);
        expect(sent).toHaveLength(4);   // the four already on their way at once; the other three files never go
    });
});

/** The fixture indexed and summarized by a stub of its own, then its rows made what Nebulosity 1.0 stored for the same input (P1). */
async function writtenBy10(): Promise<string> {
    const root = copyFixture();
    indexRepository(root);
    await runSummaries(root, { summarizer: stubSummarizer().summarizer, transport: "direct" });
    const db = getDb();
    rewriteAsWrittenBy10(db, requireRepository(db, repoKey(root)));
    return root;
}

describe("nebulosity summarize: summaries an older version wrote (P7)", () => {
    it("says how many of the requests rewrite summaries an older version wrote", async () => {
        const root = await writtenBy10();
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        expect(await runSummarize([root, "--yes"])).toBe(0);

        // a full run restyles by default: all 13 that 1.0 wrote, the 7 files, the 5 folders and the repo, each a rewrite
        expect(estimateLine(log)).toContain("about 13 requests (7 files to claude-haiku-5-5, 5 folders and the repo to claude-sonnet-5-5)");
        const tail = "Writing summaries sends each file's code to Anthropic. This includes rewriting 13 summaries an older version of Nebulosity wrote,"
            + " in the new plain style. Add --no-restyle to leave them as they are.";
        expect(ending(estimateLine(log), tail)).toBe(tail);
        expect(stub.requests).toHaveLength(13);

        // a first pass has nothing an older version wrote, so its estimate ends where it always has
        log.mockClear();
        stub.requests.length = 0;
        const fresh = copyFixture();
        indexRepository(fresh);
        expect(await runSummarize([fresh, "--yes"])).toBe(0);
        expect(estimateLine(log)).toContain("about 13 requests (7 files to claude-haiku-5-5, 5 folders and the repo to claude-sonnet-5-5)");
        expect(ending(estimateLine(log), "Writing summaries sends each file's code to Anthropic.")).toBe("Writing summaries sends each file's code to Anthropic.");
        expect(printed(log)).not.toContain("an older version");
        expect(stub.requests).toHaveLength(13);
    });

    it("leaves summaries an older version wrote alone with --no-restyle", async () => {
        const root = await writtenBy10();
        fs.appendFileSync(path.join(root, "src/core/log.ts"), "export const extra = 1;\n");
        indexRepository(root);
        // texts of their own, so each rewrite reads differently from what 1.0 stored and puts the folder above it out of date
        const edited = stubSummarizer({ texts: {
            "src/core/log.ts": { tagline: "Log lines", summary: "Writes the app's log lines." },
            "src/core": { tagline: "The core", summary: "The log and what the core exports." },
            "src": { tagline: "The source", summary: "The app, its core and its helpers." },
        } });
        summarizer = edited.summarizer;
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        expect(await runSummarize([root, "--yes", "--no-restyle"])).toBe(0);

        // the edited file, then each folder above it up to the repo (src/core, src and the repo): 4 requests, none a rewrite
        expect(estimateLine(log)).toContain("about 4 requests (1 files to claude-haiku-5-5, 2 folders and the repo to claude-sonnet-5-5)");
        expect(printed(log)).not.toContain("an older version");
        expect(edited.subjects()).toEqual(["File: src/core/log.ts", "Folder: src/core", "Folder: src", `Repository: ${path.basename(root)}`]);
        // the other 6 files and the 3 folders off that path are still what 1.0 wrote
        const db = getDb();
        expect(loadSummaries(db, requireRepository(db, repoKey(root))).filter((r) => r.promptVersion === 2).map((r) => `${r.kind} ${r.path}`).sort()).toEqual([
            "file scripts/build.js", "file src/app/main.ts", "file src/app/view.tsx", "file src/core/index.ts", "file src/index.ts", "file src/util/strings.ts",
            "folder scripts", "folder src/app", "folder src/util",
        ]);
    });

    // the Task 5 review's Important 1: a run with no key sends nothing, so it plans as the stage refresh does (P1)
    it("with no key, counts what an older version wrote as up to date and sends nothing", async () => {
        const root = await writtenBy10();
        summarizer = null;
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        expect(await runSummarize([root])).toBe(0);

        // 14 targets: the 7 files, the 5 folders and the repo 1.0 wrote, each current for the same input, and the test
        // file's template. Nothing waits for a key, so the stage is ready with no note
        expect(printed(log)).toContain("up to date 14/14 · summarized 0");
        const db = getDb();
        const stage = readStages(db, requireRepository(db, repoKey(root))).summaries;
        expect(stage).toMatchObject({ state: "ready", done: 14, total: 14 });
        expect(stage?.note).toBeUndefined();
        expect(stub.requests).toHaveLength(0);
        expect(loadSummaries(db, requireRepository(db, repoKey(root))).filter((r) => r.promptVersion === 2)).toHaveLength(13);
    });
});

describe("nebulosity summarize --path", () => {
    it("prints a one-path summary on one line", async () => {
        const root = copyFixture();
        indexRepository(root);
        summarizer = stubSummarizer({ texts: {
            "src/core/log.ts": { tagline: "Log lines", summary: "Writes the app's log lines.\n\nEach line starts with its level." },
        } }).summarizer;
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        expect(await runSummarize([root, "--path", "src/core/log.ts"])).toBe(0);

        // its two paragraphs joined by a space, so the console line is one line
        expect(printed(log).split("\n")).toContain("[summarize] Log lines — Writes the app's log lines. Each line starts with its level.");
    });
});
