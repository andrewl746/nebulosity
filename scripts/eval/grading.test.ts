import { describe, expect, it } from "vitest";
import { buildSheet, mergeGrades, validateReply, type Sheet } from "./grading";
import type { Rubric } from "./score";

const rubric: Rubric = {
    id: "bp9", source: "somewhere",
    points: [
        { id: "BP9.1", text: "first point", check: "SECRET CHECK 1", holds: true, note: "SECRET NOTE 1" },
        { id: "BP9.2", text: "false point", check: "c", holds: false, note: "n" },
        { id: "BP9.3", text: "third point", check: "c", holds: true, note: "n" },
    ],
};

const sheet: Sheet = { id: "0a1b2c3d", question: "Q?", points: [{ id: "BP9.1", text: "first point" }, { id: "BP9.3", text: "third point" }], answer: "A." };
const good = { id: "0a1b2c3d", points: [{ id: "BP9.1", score: 1, quote: "q1" }, { id: "BP9.3", score: 0.5, quote: "none" }] };

describe("buildSheet", () => {
    it("keeps only points that hold, with id and text, and no arm, run, check or note", () => {
        const s = buildSheet("0a1b2c3d", "Q?", rubric, "A.");
        expect(s).toEqual(sheet);
        expect(JSON.stringify(s)).not.toContain("SECRET");
    });
});

describe("buildSheet with an unchecked point", () => {
    it("throws, naming the point", () => {
        const r: Rubric = { id: "bp8", source: "s", points: [{ id: "BP8.1", text: "t", check: "c", holds: true, note: "n" }, { id: "BP8.2", text: "t", check: "c", holds: null, note: "n" }] };
        expect(() => buildSheet("0a1b2c3d", "Q?", r, "A.")).toThrow(/BP8\.2/);
    });
});

describe("validateReply", () => {
    it("accepts a complete reply", () => expect(validateReply(sheet, good)).toEqual([]));
    it("refuses an id that differs from the sheet's", () => expect(validateReply(sheet, { ...good, id: "ffffffff" })).toHaveLength(1));
    it("refuses a missing point", () => expect(validateReply(sheet, { ...good, points: [good.points[0]] })[0]).toContain("BP9.3"));
    it("refuses a repeated point", () => expect(validateReply(sheet, { ...good, points: [...good.points, good.points[0]] })[0]).toContain("BP9.1"));
    it("refuses an unknown point", () => expect(validateReply(sheet, { ...good, points: [...good.points, { id: "BP9.2", score: 1, quote: "x" }] })[0]).toContain("BP9.2"));
    it("refuses a score outside 0, 0.5 and 1", () => {
        expect(validateReply(sheet, { ...good, points: [{ id: "BP9.1", score: 0.75, quote: "x" }, good.points[1]] })[0]).toContain("BP9.1");
        expect(validateReply(sheet, { ...good, points: [{ id: "BP9.1", score: "1", quote: "x" }, good.points[1]] })).toHaveLength(1);
    });
    it("refuses a quote that isn't a string", () => expect(validateReply(sheet, { ...good, points: [{ id: "BP9.1", score: 1, quote: 3 }, good.points[1]] })[0]).toContain("BP9.1"));
    it("refuses something that isn't an object with a points array", () => {
        expect(validateReply(sheet, null)).toHaveLength(1);
        expect(validateReply(sheet, { id: "0a1b2c3d" })).toHaveLength(1);
    });
});

describe("mergeGrades", () => {
    it("joins replies to runs through the key, quote becomes sentence, run names sorted", () => {
        const key = { "0a1b2c3d": "bp9-nebulosity-2", "11111111": "bp9-baseline-1" };
        const other = { id: "11111111", points: [{ id: "BP9.1", score: 0, quote: "none" }, { id: "BP9.3", score: 1, quote: "yes" }] };
        const grades = mergeGrades(key, { "0a1b2c3d": good, "11111111": other });
        expect(Object.keys(grades)).toEqual(["bp9-baseline-1", "bp9-nebulosity-2"]);
        expect(grades["bp9-nebulosity-2"]).toEqual({ "BP9.1": { score: 1, sentence: "q1" }, "BP9.3": { score: 0.5, sentence: "none" } });
        expect(grades["bp9-baseline-1"]["BP9.3"]).toEqual({ score: 1, sentence: "yes" });
    });
});
