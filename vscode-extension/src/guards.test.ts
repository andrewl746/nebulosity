import { describe, expect, it } from "vitest";
import { isObject, isObjectLike, MAX_PATH_LENGTH } from "./guards";

describe("the shared guards", () => {
    it("isObject takes an object, and neither an array nor null nor a primitive", () => {
        expect(isObject({})).toBe(true);
        expect(isObject({ type: "nebulosity.ready" })).toBe(true);
        expect(isObject([])).toBe(false);
        expect(isObject(null)).toBe(false);
        expect(isObject(undefined)).toBe(false);
        expect(isObject("{}")).toBe(false);
        expect(isObject(1)).toBe(false);
    });

    it("isObjectLike takes arrays too, as the relay always has, and still neither null nor a primitive", () => {
        expect(isObjectLike({})).toBe(true);
        expect(isObjectLike([])).toBe(true);
        expect(isObjectLike(null)).toBe(false);
        expect(isObjectLike(undefined)).toBe(false);
        expect(isObjectLike("x")).toBe(false);
    });

    it("a stored path is at most 1,024 characters (API_CONTRACTS §19, §20)", () => {
        expect(MAX_PATH_LENGTH).toBe(1024);
    });
});
