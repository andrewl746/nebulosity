import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { stubSummarizer } from "../../test/helpers/summarizer";
import { embedSummaries, type EmbedFn } from "../index/embed";
import { indexRepository } from "../index/pipeline";
import { runSummaries } from "../index/summarize/run";
import { fuseRankings, search, toFtsQuery } from "./search";

/**
 * A stand-in for MiniLM where "meaning" is hand-checkable: one dimension per group of
 * words that mean the same thing.
 */
const GROUPS = [["paint", "draw", "draws", "render", "renders"], ["log", "logs", "logging", "logger"]];
const fakeEmbed: EmbedFn = async (texts) => texts.map((text) => {
    const words = text.toLowerCase().split(/[^a-z]+/);
    const v = Float32Array.from(GROUPS.map((group) => words.filter((w) => group.includes(w)).length));
    const norm = Math.hypot(...v);
    return norm === 0 ? v : v.map((x) => x / norm);
});
const neverEmbed: EmbedFn = async () => { throw new Error("the model should not load: there are no vectors"); };

const TEXTS = {
    "src/core/log.ts": { tagline: "Console logging helpers", summary: "Defines log and the Logger class." },
    "src/core": { tagline: "Core services", summary: "Logging and the core barrel." },
    "src/app/view.tsx": { tagline: "Draws the app view", summary: "Renders the View component." },
};

function indexedFixture(): string {
    const root = copyFixture();
    indexRepository(root);
    return root;
}

async function summarizedFixture(): Promise<string> {
    const root = indexedFixture();
    await runSummaries(root, { summarizer: stubSummarizer({ texts: TEXTS }).summarizer, transport: "direct" });
    await embedSummaries(root, { embed: fakeEmbed });
    return root;
}

describe("toFtsQuery", () => {
    it("keeps the meaningful words of a question, each quoted, ORed", () => {
        expect(toFtsQuery("Where are editor tabs rendered?")).toBe('"editor" OR "tabs" OR "rendered"');
    });

    it("adds the words inside an identifier next to the identifier itself", () => {
        expect(toFtsQuery("openEditor")).toBe('"openeditor" OR "open" OR "editor"');
        expect(toFtsQuery("ICodeEditorService")).toBe('"icodeeditorservice" OR "code" OR "editor" OR "service"');
    });

    it("neutralizes FTS5 syntax, and returns null when nothing searchable is left", () => {
        expect(toFtsQuery('src/vs/* AND "tabs"')).toBe('"src" OR "vs" OR "tabs"');
        expect(toFtsQuery('" OR NOT (')).toBeNull();
        expect(toFtsQuery("the")).toBeNull();
    });
});

describe("fuseRankings", () => {
    it("adds 1 / (60 + rank) for every list that ranks a target, best total first", () => {
        const fused = fuseRankings({ code: ["a", "b", "c"], summary: ["b"], vector: ["c", "b"] });
        expect(fused.map((f) => [f.key, f.matchedBy])).toEqual([
            ["b", ["code", "summary", "vector"]],
            ["c", ["code", "vector"]],
            ["a", ["code"]],
        ]);
        expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61 + 1 / 62, 12);
        expect(fused[1].score).toBeCloseTo(1 / 63 + 1 / 61, 12);
        expect(fused[2].score).toBeCloseTo(1 / 61, 12);
    });

    it("breaks ties by key, so the order never depends on luck", () => {
        expect(fuseRankings({ code: ["file:y"], summary: ["file:x"] }).map((f) => f.key)).toEqual(["file:x", "file:y"]);
    });
});

describe("search", () => {
    it("finds a declaration by name with code keywords alone, before any summary exists", async () => {
        const result = await search(indexedFixture(), "shout", { embed: neverEmbed });
        expect(result.hits[0]).toEqual({
            path: "src/util/strings.ts", kind: "file", score: 1 / 61, matchedBy: ["code"],
            code: { symbol: "shout", startLine: 3, endLine: 6, snippet: expect.stringContaining("shout") },
        });
        expect(result.lists).toEqual({ code: 3, summary: 0, vector: 0 });
        expect(result.note).toBe("Summaries aren't ready yet, so results come from code keywords only.");
    });

    it("ranks the file every list agrees on first, and finds the folder through its summary and meaning", async () => {
        const result = await search(await summarizedFixture(), "logging", { embed: fakeEmbed });
        expect(result.hits[0]).toMatchObject({ path: "src/core/log.ts", kind: "file", matchedBy: ["code", "summary", "vector"], tagline: "Console logging helpers" });
        expect(result.hits[1]).toMatchObject({ path: "src/core", kind: "folder", matchedBy: ["summary", "vector"], tagline: "Core services" });
        expect(result.note).toBeUndefined();
    });

    it("finds by meaning a summary that shares no word with the query", async () => {
        const result = await search(await summarizedFixture(), "paint", { embed: fakeEmbed });
        expect(result.hits).toEqual([{
            path: "src/app/view.tsx", kind: "file", score: 1 / 61, matchedBy: ["vector"],
            tagline: "Draws the app view", summary: "Renders the View component.",
        }]);
        expect(result.lists).toEqual({ code: 0, summary: 0, vector: 1 });
    });

    it("never throws on FTS5 syntax in the query", async () => {
        const result = await search(indexedFixture(), 'shout(" OR NOT *', { embed: neverEmbed });
        expect(result.hits[0].path).toBe("src/util/strings.ts");
    });

    it("keeps the keyword results when the embedding model fails, and says so", async () => {
        const offline: EmbedFn = async () => { throw new Error("offline"); };
        const result = await search(await summarizedFixture(), "shout", { embed: offline });
        expect(result.hits[0].path).toBe("src/util/strings.ts");
        expect(result.note).toBe("Meaning search is unavailable (offline), so results come from keywords only.");
    });
});
