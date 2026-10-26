import { describe, expect, it } from "vitest";
import { clearStart, markStart } from "./perf";

const starts = (name: string): number => performance.getEntriesByName(`${name}:start`, "mark").length;

describe("the S3 timing marks", () => {
    it("markStart keeps one start mark per name", () => {
        markStart("test:level");
        markStart("test:level");
        expect(starts("test:level")).toBe(1);
        clearStart("test:level");
    });

    it("clearStart drops a start nothing will measure, so the next draw isn't timed from it (PR #10 review, 11)", () => {
        markStart("test:jump");
        markStart("test:other");
        clearStart("test:jump");
        expect(starts("test:jump")).toBe(0);
        // only that name's
        expect(starts("test:other")).toBe(1);
        clearStart("test:other");
    });
});
