import { describe, expect, it } from "vitest";
import { choosePort, DEFAULT_PORT, parsePrintedPort } from "./ports";

describe("parsePrintedPort (nebulosity map --print-port's answer, V1.8 plan P2)", () => {
    it("reads one port on its own line", () => {
        expect(parsePrintedPort("3125\n")).toBe(3125);
        expect(parsePrintedPort("3125\r\n")).toBe(3125);          // Windows
        expect(parsePrintedPort("  3000  ")).toBe(3000);
    });

    it("refuses anything else", () => {
        expect(parsePrintedPort("")).toBeNull();
        expect(parsePrintedPort("abc")).toBeNull();
        expect(parsePrintedPort("0")).toBeNull();
        expect(parsePrintedPort("70000")).toBeNull();
        expect(parsePrintedPort("3000\nmore")).toBeNull();
    });
});

describe("choosePort (the setting, else --print-port, else 3000)", () => {
    it("takes the first one there is", () => {
        expect(choosePort(4000, 3125)).toBe(4000);
        expect(choosePort(null, 3125)).toBe(3125);
        expect(choosePort(undefined, null)).toBe(3000);
        expect(DEFAULT_PORT).toBe(3000);
    });
});
