import { describe, expect, it } from "vitest";
import type { IndexStatus, StageStatus } from "@/lib/contracts";
import { ago, formatCompact, formatCount, headline, stageLabel } from "./format";

const stage = (state: StageStatus["state"], done = 0, total = 0): StageStatus => ({ state, done, total });
const status = (structure: StageStatus, summaries: StageStatus, embeddings: StageStatus): IndexStatus =>
    ({ repo: "C:/r", stages: { structure, summaries, embeddings }, indexVersion: 1 });

describe("format", () => {
    it("writes counts and times as people read them", () => {
        expect(formatCount(20648)).toBe("20,648");
        expect(ago(1_000)).toBe("just now");
        expect(ago(12_400)).toBe("12 s ago");
        expect(ago(185_000)).toBe("3 min ago");
        expect(stageLabel("summaries", stage("ready", 12340, 18637))).toBe("Summaries 12,340 / 18,637, ready");
    });

    it("writes big counts compactly: one decimal, K, M or B by size (VISUAL_REFRESH.md §5: \"3.4M lines\")", () => {
        expect(formatCompact(0)).toBe("0");
        expect(formatCompact(999)).toBe("999");
        expect(formatCompact(1_000)).toBe("1K");
        expect(formatCompact(1_234)).toBe("1.2K");
        expect(formatCompact(12_345)).toBe("12.3K");
        expect(formatCompact(999_949)).toBe("999.9K");
        expect(formatCompact(999_950)).toBe("1M");   // rounds up to 1,000K, which is 1M
        expect(formatCompact(3_395_641)).toBe("3.4M");
        expect(formatCompact(10_000_000)).toBe("10M");
        expect(formatCompact(1_250_000_000)).toBe("1.3B");
    });

    it("heads the status pill with the stage that most needs attention", () => {
        const ready = stage("ready", 10, 10);
        expect(headline(status(stage("running", 4210, 14844), stage("idle"), stage("idle")))).toEqual({ tone: "busy", text: "Indexing 4,210 / 14,844" });
        expect(headline(status(ready, stage("failed", 3, 10), ready))).toEqual({ tone: "warn", text: "Summaries failed" });
        expect(headline(status(ready, stage("off", 1, 14), stage("idle")))).toEqual({ tone: "off", text: "Summaries off (no API key)" });
        expect(headline(status(ready, ready, stage("idle", 12, 13)))).toEqual({ tone: "busy", text: "Search vectors 12 / 13" });
        expect(headline(status(ready, ready, ready))).toEqual({ tone: "ok", text: "Up to date" });
    });
});
