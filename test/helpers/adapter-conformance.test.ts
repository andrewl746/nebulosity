import { describe, expect, it } from "vitest";
import type { Reading } from "../../lib/index/languages/adapter";
import { describeAdapterConformance, k13Texts } from "./adapter-conformance";
import { toyAdapter } from "./toy-adapter";
import { toyRepoTruth } from "./toy-repo-truth";

// The kit on the toy language: what every language task's conformance.test.ts does with its own adapter and fixture.
describeAdapterConformance(toyAdapter, { name: "toy-repo", truth: toyRepoTruth });

describe("K13's texts (Task I: a file saved with a byte-order mark got two in the BOM copy)", () => {
    const BOM = "﻿";

    it("are LF, its CRLF twin and one U+FEFF before LF, from a file read with or without its own mark", () => {
        const expected = { lf: "use a\ndef b\n", crlf: "use a\r\ndef b\r\n", bom: `${BOM}use a\ndef b\n` };
        expect(k13Texts("use a\ndef b\n")).toEqual(expected);
        expect(k13Texts("use a\r\ndef b\r\n")).toEqual(expected);
        expect(k13Texts(`${BOM}use a\r\ndef b\r\n`)).toEqual(expected);
        expect(k13Texts(`${BOM}use a\ndef b\n`)).toEqual(expected);
    });

    it("let an adapter that drops one mark, as parseTree and the toy do, read a BOM file's copies the same", () => {
        // the toy drops a leading U+FEFF; with two, its first line would start with the second and read as nothing
        const { lf, bom } = k13Texts(`${BOM}use lib/strings\r\ndef greet\r\n`);
        for (const reading of ["full", "parse", "scan"] as Reading[]){
            expect(toyAdapter.parse("app/x.toy", bom, reading), reading).toEqual(toyAdapter.parse("app/x.toy", lf, reading));
        }
        expect(toyAdapter.parse("app/x.toy", bom, "full").imports).toEqual(["use:lib/strings"]);
    });
});
