import { describe, expect, it } from "vitest";
import { nextPulses } from "./pulses";

describe("nextPulses", () => {
    it("pulses a box at most once per 800 ms, however many tool calls touch it", () => {
        let state = nextPulses(new Map(), ["src", "src"], 1_000);
        expect(state.get("src")).toEqual({ key: 1, at: 1_000 });
        state = nextPulses(state, ["src", "lib"], 1_500);
        expect(state.get("src")).toEqual({ key: 1, at: 1_000 });   // too soon: no new pulse
        expect(state.get("lib")).toEqual({ key: 1, at: 1_500 });
        state = nextPulses(state, ["src"], 1_800);
        expect(state.get("src")).toEqual({ key: 2, at: 1_800 });
    });
});
