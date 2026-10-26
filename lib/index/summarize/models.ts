import { configPath, readConfigFile } from "../../config";
import type { SummaryModelSetting, SummaryModelsSetting } from "../../contracts";
import { pricePerMTok, type ModelPrice } from "./pricing";
import { SUMMARY_MODELS } from "./prompts";

/**
 * The summary models as a setting (ADR-066): `summaryModels` in config.json names a model for any of the three kinds,
 * with its prices when the built-in table (pricing.ts) doesn't have them. When Anthropic retires the defaults
 * (SUMMARY_MODELS), a user moves to a newer model here, without a new release of Nebulosity.
 */

type Kind = keyof SummaryModelsSetting;

/**
 * The kinds a setting can name, in the order messages list them, and the fields of one kind's entry: the contract's
 * keys (lib/contracts.ts, API_CONTRACTS.md §21). Each is a Record over those keys, which has to list every one exactly
 * once, so the validator can't drift from the contract. Any other field is refused: a misspelt price would otherwise
 * be ignored.
 */
const KIND_NAMES: Record<Kind, true> = { file: true, folder: true, repo: true };
const FIELD_NAMES: Record<keyof SummaryModelSetting, true> = { model: true, inputPerMTok: true, outputPerMTok: true };
const KINDS = Object.keys(KIND_NAMES) as Kind[];
const FIELDS: readonly string[] = Object.keys(FIELD_NAMES);

/** A model id's longest accepted length. Anthropic's ids run to about 30 characters; this only stops a pasted paragraph. */
export const MAX_MODEL_ID_LENGTH = 200;

/** What every reader plans, sends and prices with: the model for each kind, every model's price, and which kinds are set. */
export type ResolvedSummaryModels = {
    models: Readonly<Record<Kind, string>>;
    /** The price of every model in `models`: the setting's where given, else the built-in table's. */
    prices: Readonly<Record<string, ModelPrice>>;
    /** true where the setting names the kind. A set model goes without the Sonnet fallback beta (R3). */
    custom: Readonly<Record<Kind, boolean>>;
};

export type SummaryModelsResolution = ({ ok: true } & ResolvedSummaryModels) | { ok: false; error: string };

/** The prices one model was given in the setting, field by field, with the field that gave each (for a disagreement). */
type GivenPrices = { input?: { usd: number; field: string }; output?: { usd: number; field: string } };

/**
 * Thrown when summaries are asked for while summaryModels can't be used (the message is the resolver's, naming the
 * fields and the config file). Nothing is planned or sent until the setting is fixed.
 */
export class SummaryModelsError extends Error {
    constructor(message: string){
        super(message);
        this.name = "SummaryModelsError";
    }
}

/** The defaults (ADR-028) at the table's prices, as with no setting at all. */
export const DEFAULT_SUMMARY_MODELS: ResolvedSummaryModels = {
    models: { ...SUMMARY_MODELS },
    prices: pricesFor(SUMMARY_MODELS, new Map()),
    custom: { file: false, folder: false, repo: false },
};

/**
 * Reads the setting (summaryModels in config.json, as readConfig found it) into the models and prices every reader
 * uses, or one error that names each field that's wrong and the config file. No setting (or null) is the defaults.
 * - A kind left out keeps its default. A kind's model is trimmed of surrounding whitespace, and the trimmed id, which
 *   is what's sent and hashed, has 1 to MAX_MODEL_ID_LENGTH characters.
 * - Prices are US dollars per million tokens, finite and 0 or more. They're required for a model the table doesn't
 *   price (an exact id, or a dated snapshot of one, as pricePerMTok); for one it does, each given price wins over the
 *   table's.
 * - Spend is recorded per model, so one model given two different prices (by two kinds) is refused.
 */
export function resolveSummaryModels(setting: unknown, configFile: string): SummaryModelsResolution {
    if (setting === undefined || setting === null) return { ok: true, ...DEFAULT_SUMMARY_MODELS };
    if (!isObject(setting)) return refuse([`summaryModels must be an object keyed by "file", "folder" or "repo"`], configFile);

    const problems: string[] = [];
    const models: Record<Kind, string> = { ...SUMMARY_MODELS };
    const custom: Record<Kind, boolean> = { file: false, folder: false, repo: false };
    const given = new Map<string, GivenPrices>();
    /** Price fields that were there but wrong: already reported, so not reported as missing too. */
    const wrong = new Set<string>();

    for (const [kind, entry] of Object.entries(setting)){
        const at = `summaryModels.${kind}`;
        if (!isKind(kind)){
            problems.push(`${at} isn't a kind (the kinds are "file", "folder" and "repo")`);
            continue;
        }
        if (!isObject(entry)){
            problems.push(`${at} must be an object with a "model"`);
            continue;
        }
        for (const field of Object.keys(entry)){
            if (!FIELDS.includes(field)) problems.push(`${at}.${field} isn't a field (the fields are "model", "inputPerMTok" and "outputPerMTok")`);
        }

        // " claude-haiku-6" would be sent with its space, and answered with a 404
        const model = typeof entry.model === "string" ? entry.model.trim() : undefined;
        if (model === undefined || model === "" || model.length > MAX_MODEL_ID_LENGTH){
            problems.push(`${at}.model must be a model id: a string of 1 to ${MAX_MODEL_ID_LENGTH} characters, not blank`);
            continue;
        }
        models[kind] = model;
        custom[kind] = true;

        const prices = given.get(model) ?? {};
        for (const [field, side] of [["inputPerMTok", "input"], ["outputPerMTok", "output"]] as const){
            const value = entry[field];
            if (value === undefined) continue;
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0){
                problems.push(`${at}.${field} must be a number of US dollars per million tokens, 0 or more`);
                wrong.add(`${at}.${field}`);
                continue;
            }
            const earlier = prices[side];
            if (earlier && earlier.usd !== value){
                problems.push(`${at}.${field} (${value}) disagrees with ${earlier.field} (${earlier.usd}) for ${model}: spend is recorded per model, so a model has one price`);
                continue;
            }
            prices[side] = { usd: value, field: `${at}.${field}` };
        }
        given.set(model, prices);
    }

    // Once every kind is read, so a price another kind gave the same model counts. Without a price the estimate and the
    // spend cap would count the model as $0 (Review Focus 3).
    for (const kind of KINDS){
        const model = models[kind];
        if (!custom[kind] || pricePerMTok(model)) continue;
        const missing = (["input", "output"] as const)
            .filter((side) => !given.get(model)?.[side])
            .map((side) => `summaryModels.${kind}.${side}PerMTok`)
            .filter((field) => !wrong.has(field));
        if (missing.length > 0){
            problems.push(`${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing: there's no price on file for ${model}, so its prices have to be set`);
        }
    }

    if (problems.length > 0) return refuse(problems, configFile);
    return { ok: true, models, prices: pricesFor(models, given), custom };
}

/**
 * The setting in config.json right now, read as the Map and the worker read it at each job. A file that's there but
 * can't be read (readConfigFile's problem: a trailing comma, say) can't be used either (R25): what it sets is unknown, and
 * summarizing with the defaults instead would spend on models the user may have moved away from, so summarize and
 * doctor refuse it with the file and the parse error. A missing file is the defaults.
 */
export function configuredSummaryModels(): SummaryModelsResolution {
    const { config, problem } = readConfigFile();
    if (problem !== null){
        return { ok: false, error: `The summary models can't be read: ${problem}. Fix the file so it holds one JSON object (see the README's "Summary models"); summaries wait until then.` };
    }
    return resolveSummaryModels(config.summaryModels, configPath());
}

/** "files claude-haiku-6 (set in <config>), folders claude-sonnet-5-5, the repo claude-sonnet-5-5", or the defaults: for nebulosity doctor. */
export function describeSummaryModels(resolved: ResolvedSummaryModels, configFile: string = configPath()): string {
    const label: Record<Kind, string> = { file: "files", folder: "folders", repo: "the repo" };
    const kinds = KINDS.map((kind) => `${label[kind]} ${resolved.models[kind]}${resolved.custom[kind] ? ` (set in ${configFile})` : ""}`).join(", ");
    return KINDS.some((kind) => resolved.custom[kind]) ? kinds : `${kinds} (the defaults; summaryModels in ${configFile} changes them)`;
}

function refuse(problems: readonly string[], configFile: string): SummaryModelsResolution {
    return { ok: false, error: `The summary models in ${configFile} can't be used: ${problems.join("; ")}. See the README's "Summary models".` };
}

/** Each model's price: what the setting gave, field by field, else the built-in table's. */
function pricesFor(models: Readonly<Record<Kind, string>>, given: ReadonlyMap<string, GivenPrices>): Record<string, ModelPrice> {
    const prices: Record<string, ModelPrice> = {};
    for (const model of new Set(Object.values(models))){
        const table = pricePerMTok(model);
        const input = given.get(model)?.input?.usd ?? table?.input;
        const output = given.get(model)?.output?.usd ?? table?.output;
        // the resolver refused a set model missing either, and every default is in the table (pricing.test.ts)
        if (input !== undefined && output !== undefined) prices[model] = { input, output };
    }
    return prices;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKind(kind: string): kind is Kind {
    return Object.hasOwn(KIND_NAMES, kind);
}
