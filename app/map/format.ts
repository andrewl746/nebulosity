import type { IndexStatus, StageName, StageStatus } from "@/lib/contracts";

/** 20648 → "20,648". */
export function formatCount(n: number): string {
    return n.toLocaleString("en-US");
}

/** How long ago something happened, in words: "just now", "12 s ago", "3 min ago", "2 h ago". */
export function ago(ms: number): string {
    if (ms < 5_000) return "just now";
    if (ms < 60_000) return `${Math.floor(ms / 1000)} s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
    return `${Math.floor(ms / 3_600_000)} h ago`;
}

const TITLES: Record<StageName, string> = { structure: "Structure", summaries: "Summaries", embeddings: "Search vectors" };
const VERBS: Record<StageName, string> = { structure: "Indexing", summaries: "Summarizing", embeddings: "Embedding" };
const ORDER: readonly StageName[] = ["structure", "summaries", "embeddings"];

const progress = (stage: StageStatus): string => (stage.total > 0 ? ` ${formatCount(stage.done)} / ${formatCount(stage.total)}` : "");

/** One stage as the status menu lists it: "Summaries 12,340 / 18,637 · ready". */
export function stageLabel(name: StageName, stage: StageStatus): string {
    return `${TITLES[name]}${progress(stage)} · ${stage.state}`;
}

export type Tone = "ok" | "busy" | "warn" | "off";

/**
 * The status pill's one line: the stage that most needs attention. A running stage comes first, then a failed one.
 * Then structure not ready, summaries off, and work waiting. Otherwise "Up to date".
 */
export function headline(status: IndexStatus): { tone: Tone; text: string } {
    for (const name of ORDER){
        if (status.stages[name].state === "running") return { tone: "busy", text: `${VERBS[name]}${progress(status.stages[name])}` };
    }
    for (const name of ORDER){
        if (status.stages[name].state === "failed") return { tone: "warn", text: `${TITLES[name]} failed` };
    }
    if (status.stages.structure.state !== "ready") return { tone: "warn", text: "Not indexed yet" };
    if (status.stages.summaries.state === "off") return { tone: "off", text: "Summaries off (no API key)" };
    for (const name of ORDER){
        const stage = status.stages[name];
        if (stage.state === "idle" && stage.total > stage.done) return { tone: "busy", text: `${TITLES[name]}${progress(stage)}` };
    }
    return { tone: "ok", text: "Up to date" };
}
