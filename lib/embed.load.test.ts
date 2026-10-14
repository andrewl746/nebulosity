import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// The model itself is mocked here, so nothing is downloaded or loaded. lib/embed.test.ts is the file that runs the real one.
const pipeline = vi.hoisted(() => vi.fn());
vi.mock("@huggingface/transformers", () => ({ pipeline }));

/** What the real pipeline returns for a batch: one tensor, `dims` [rows, 384], rows laid end to end. */
const fakePipe = async (batch: string[]) => ({ dims: [batch.length, 384], data: new Float32Array(batch.length * 384) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A model load that finishes only when the test says so, so every caller that is going to start a load has done so first. */
function loadHeldUntilReleased(): () => void {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    pipeline.mockImplementation(async () => { await held; return fakePipe; });
    return release;
}

let stderr: MockInstance<typeof console.error>;
/** How many times lib/embed.ts announced a model load. */
const loadsAnnounced = (): number => stderr.mock.calls.filter(([line]) => String(line).startsWith("[embed] loading")).length;

beforeEach(() => {
    pipeline.mockReset();
    vi.resetModules();   // a fresh lib/embed.ts, so its cached pipeline starts empty
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("loading the embedding model (lib/embed.ts)", () => {
    it("loads it once when two embeds start together", async () => {
        // Claude Code sends tool calls in parallel, so two searches can reach the first embed at the same moment
        const release = loadHeldUntilReleased();
        const { embedTexts } = await import("./embed");
        const both = Promise.all([embedTexts(["one"]), embedTexts(["two", "three"])]);
        await sleep(100);   // long enough for a second load to start, if one is going to
        release();
        const [first, second] = await both;
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(2);
        // Two separate checks: Vitest can hand a second, concurrent dynamic import the real module instead of the mock, so
        // the factory's own call count alone would not notice a second load. Each load also announces itself on stderr.
        expect(loadsAnnounced()).toBe(1);
        expect(pipeline).toHaveBeenCalledTimes(1);
        await embedTexts(["four"]);
        expect(loadsAnnounced()).toBe(1);   // and later calls reuse it
        expect(pipeline).toHaveBeenCalledTimes(1);
    });

    it("tries again on the next call after a failed load, instead of caching the failure", async () => {
        pipeline.mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => fakePipe);
        const { embedTexts } = await import("./embed");
        await expect(embedTexts(["one"])).rejects.toThrow("offline");
        expect(await embedTexts(["one"])).toHaveLength(1);
        expect(pipeline).toHaveBeenCalledTimes(2);
        expect(loadsAnnounced()).toBe(2);
    });
});
