import { describe, expect, it } from "vitest";
import { resolveSummaryModels } from "./models";

// The expectations are the plan's decisions (Task M) and pricing.ts's table, read by hand: Haiku 5.5 at $0.10 / $0.50
// per million tokens, Sonnet 5.5 at $2 / $10, and a longer id takes its family's price.
const CONFIG = "C:/Users/me/AppData/Local/Nebulosity/config.json";
const HAIKU = { input: 0.10, output: 0.50 };
const SONNET = { input: 2, output: 10 };

/** The error a setting gives, or a failure that names what came back instead. */
function errorOf(setting: unknown): string {
    const resolved = resolveSummaryModels(setting, CONFIG);
    if (resolved.ok) throw new Error(`expected an error, got ${JSON.stringify(resolved)}`);
    return resolved.error;
}

describe("resolveSummaryModels", () => {
    it("gives the three defaults at the table's prices, none of them set, when there's no setting", () => {
        const expected = {
            ok: true,
            models: { file: "claude-haiku-5-5", folder: "claude-sonnet-5-5", repo: "claude-sonnet-5-5" },
            prices: { "claude-haiku-5-5": HAIKU, "claude-sonnet-5-5": SONNET },
            custom: { file: false, folder: false, repo: false },
        };
        expect(resolveSummaryModels(undefined, CONFIG)).toEqual(expected);
        // null is how a JSON file says "not set"
        expect(resolveSummaryModels(null, CONFIG)).toEqual(expected);
        expect(resolveSummaryModels({}, CONFIG)).toEqual(expected);
    });

    it("takes a kind's model and prices from the setting, and leaves the kinds it doesn't name at their defaults", () => {
        expect(resolveSummaryModels({ file: { model: "claude-haiku-6", inputPerMTok: 0.1, outputPerMTok: 0.5 } }, CONFIG)).toEqual({
            ok: true,
            models: { file: "claude-haiku-6", folder: "claude-sonnet-5-5", repo: "claude-sonnet-5-5" },
            prices: { "claude-haiku-6": { input: 0.1, output: 0.5 }, "claude-sonnet-5-5": SONNET },
            custom: { file: true, folder: false, repo: false },
        });
    });

    it("refuses a model the table doesn't price when its prices are missing, naming each field and the config file", () => {
        const error = errorOf({ file: { model: "claude-zeta-1" } });
        expect(error).toContain("summaryModels.file.inputPerMTok");
        expect(error).toContain("summaryModels.file.outputPerMTok");
        expect(error).toContain("claude-zeta-1");
        expect(error).toContain(CONFIG);

        // one price given: only the other is missing
        const half = errorOf({ file: { model: "claude-zeta-1", inputPerMTok: 0.1 } });
        expect(half).toContain("summaryModels.file.outputPerMTok");
        expect(half).not.toContain("summaryModels.file.inputPerMTok");
    });

    it("prices a set model of the table's family at the table's prices, and lets a given price win field by field", () => {
        expect(resolveSummaryModels({ folder: { model: "claude-sonnet-5-5-20261001" } }, CONFIG)).toEqual({
            ok: true,
            models: { file: "claude-haiku-5-5", folder: "claude-sonnet-5-5-20261001", repo: "claude-sonnet-5-5" },
            prices: { "claude-haiku-5-5": HAIKU, "claude-sonnet-5-5-20261001": SONNET, "claude-sonnet-5-5": SONNET },
            custom: { file: false, folder: true, repo: false },
        });

        // input from the setting, output still the table's $10
        const resolved = resolveSummaryModels({ repo: { model: "claude-sonnet-5-5", inputPerMTok: 1 } }, CONFIG);
        expect(resolved).toMatchObject({ ok: true, prices: { "claude-sonnet-5-5": { input: 1, output: 10 } }, custom: { file: false, folder: false, repo: true } });
    });

    it("refuses an empty model, a kind other than file, folder or repo, and a setting that isn't an object", () => {
        const empty = errorOf({ file: { model: "" } });
        expect(empty).toContain("summaryModels.file.model");
        expect(empty).toContain(CONFIG);

        const blob = errorOf({ blob: { model: "x" } });
        expect(blob).toContain("summaryModels.blob");
        expect(blob).toContain(CONFIG);

        for (const setting of ["text", ["file"], 3]){
            const error = errorOf(setting);
            expect(error).toContain("summaryModels");
            expect(error).toContain(CONFIG);
        }
    });

    it("refuses a model id over 200 characters, a price that isn't a number of dollars from 0 up, and a field it doesn't know", () => {
        expect(errorOf({ file: { model: "c".repeat(201), inputPerMTok: 1, outputPerMTok: 1 } })).toContain("summaryModels.file.model");
        expect(resolveSummaryModels({ file: { model: "c".repeat(200), inputPerMTok: 1, outputPerMTok: 1 } }, CONFIG).ok).toBe(true);

        expect(errorOf({ file: { model: "claude-haiku-6", inputPerMTok: -0.1, outputPerMTok: 0.5 } })).toContain("summaryModels.file.inputPerMTok");
        expect(errorOf({ file: { model: "claude-haiku-6", inputPerMTok: "0.1", outputPerMTok: 0.5 } })).toContain("summaryModels.file.inputPerMTok");
        // a free model is allowed: 0 is a price
        expect(resolveSummaryModels({ file: { model: "claude-haiku-6", inputPerMTok: 0, outputPerMTok: 0 } }, CONFIG).ok).toBe(true);

        // a misspelt price would otherwise be ignored, and the estimate made at the table's price
        expect(errorOf({ folder: { model: "claude-sonnet-5-5", inputPerMtok: 1 } })).toContain("summaryModels.folder.inputPerMtok");
        expect(errorOf({ folder: "claude-sonnet-6" })).toContain("summaryModels.folder");
    });

    it("refuses one model given two different prices: spend is recorded per model, so a model has one price", () => {
        const error = errorOf({
            folder: { model: "claude-sonnet-6", inputPerMTok: 2, outputPerMTok: 10 },
            repo: { model: "claude-sonnet-6", inputPerMTok: 3, outputPerMTok: 15 },
        });
        expect(error).toContain("summaryModels.repo");
        expect(error).toContain("summaryModels.folder");

        // the same prices twice are one price
        expect(resolveSummaryModels({
            folder: { model: "claude-sonnet-6", inputPerMTok: 2, outputPerMTok: 10 },
            repo: { model: "claude-sonnet-6", inputPerMTok: 2, outputPerMTok: 10 },
        }, CONFIG).ok).toBe(true);
    });
});
