import fs from "fs";
import path from "path";
import { dataPath } from "./home";

/** The port the Map's server listens on (npm run dev's default); live events are posted to it (PIVOT_SPEC.md §8). */
export const DEFAULT_PORT = 3000;

/** What a config.json that can't be read is renamed to, before its date, when the file is rewritten (R25). */
export const MOVED_ASIDE_MARK = ".invalid-";

/**
 * Small user-level settings that outlive any one run (API_CONTRACTS.md §21). Keys this version doesn't know are kept
 * as found too, so a newer copy's settings survive an older copy's rewrite.
 */
export type NebulosityConfig = {
    activeRepo: string | null;
    port: number;
    /**
     * The summary models (ADR-066) exactly as the file holds them, valid or not: resolveSummaryModels checks them when
     * summaries are planned, so a broken setting never stops the Map from starting, and a rewrite never drops it.
     */
    summaryModels?: unknown;
};

/**
 * What reading config.json found. `problem` says why a file that's there couldn't be read as settings (R25, the
 * pre-ship pass's final review A-I2), naming the file; it's null for a file that read, and for no file at all.
 */
export type ConfigRead = { config: NebulosityConfig; problem: string | null };

/** The settings file: config.json in the data folder (NEBULOSITY_DATA moves it). Messages that send people there name it. */
export function configPath(): string {
    return dataPath("config.json");
}

/** The settings, or the defaults when there are none, or none that can be read (readConfigFile says which). */
export function readConfig(): NebulosityConfig {
    return readConfigFile().config;
}

/**
 * config.json as found (API_CONTRACTS.md §21). A file with no settings in it (missing, or nothing but whitespace) gives
 * the defaults. So does one that's there but isn't one JSON object (a hand edit's trailing comma, another JSON value, a
 * read that fails), and then `problem` says what's wrong: the Map and the MCP server start on the defaults, while
 * `nebulosity summarize` and doctor refuse (configuredSummaryModels), and writeConfig moves the file aside first.
 * A leading UTF-8 byte-order mark is skipped, and UTF-16 is read when its mark leads: Windows PowerShell 5.1 writes
 * both (`Set-Content -Encoding utf8`, and `>`), and so does Notepad's "UTF-8 with BOM".
 */
export function readConfigFile(): ConfigRead {
    const file = configPath();
    const defaults = (problem: string | null = null): ConfigRead => ({ config: { activeRepo: null, port: DEFAULT_PORT }, problem });

    let bytes: Buffer;
    try{
        bytes = fs.readFileSync(file);
    } catch (err){
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaults();   // nothing chosen yet
        return defaults(`${file} couldn't be read (${messageOf(err)})`);
    }

    const text = decode(bytes);
    if (text.trim() === "") return defaults();   // nothing in it, so nothing set and nothing to lose

    let raw: unknown;
    try{
        raw = JSON.parse(text);
    } catch (err){
        return defaults(`${file} isn't valid JSON (${messageOf(err)})`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)){
        return defaults(`${file} holds ${raw === null ? "null" : Array.isArray(raw) ? "an array" : `a ${typeof raw}`}, not one JSON object of settings`);
    }

    const found = raw as Record<string, unknown>;
    const port = typeof found.port === "number" && Number.isInteger(found.port) && found.port > 0 && found.port < 65_536 ? found.port : DEFAULT_PORT;
    // Everything else as found: the Map's repo picker and `nebulosity index` rewrite the file with
    // writeConfig({ ...readConfig(), activeRepo }), and that must keep summaryModels (Review Focus 1).
    return { config: { ...found, activeRepo: typeof found.activeRepo === "string" ? found.activeRepo : null, port }, problem: null };
}

/**
 * Writes the settings. A config.json that's there but can't be read (readConfigFile's `problem`) is never written over:
 * it's renamed to `config.json.invalid-<time>` beside it first, and `say` (stderr by default) says where, so a hand edit
 * with a typo survives the next repo pick or index run (R25). Returns that file's path, or null when nothing was moved.
 * A rename that fails throws, and nothing is written.
 */
export function writeConfig(config: NebulosityConfig, say: (message: string) => void = (message) => console.error(message)): string | null {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const { problem } = readConfigFile();
    let aside: string | null = null;
    if (problem !== null){
        aside = movedAsidePath(file);
        fs.renameSync(file, aside);
        say(`[nebulosity] ${problem}, so it was moved aside to ${aside} before the settings were written again; copy what you need from it into ${file}, then delete it`);
    }

    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    return aside;
}

/** The files writeConfig moved aside in the data folder (R25), oldest first: nebulosity doctor lists them. */
export function movedAsideConfigs(): string[] {
    const file = configPath();
    const prefix = path.basename(file) + MOVED_ASIDE_MARK;
    try{
        return fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith(prefix)).sort().map((name) => path.join(path.dirname(file), name));
    } catch{
        return [];   // no data folder yet: nothing was moved
    }
}

/** `config.json.invalid-2026-10-25T13-50-12-345Z`: the time without colons, which Windows forbids in a name; never an existing file. */
function movedAsidePath(file: string): string {
    const base = `${file}${MOVED_ASIDE_MARK}${new Date().toISOString().replace(/[:.]/g, "-")}`;
    let candidate = base;
    for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}`;
    return candidate;
}

/**
 * The file's text: UTF-16 when its byte-order mark leads (little- or big-endian), else UTF-8 with any leading mark
 * dropped. JSON.parse would refuse the mark itself ("﻿{}" isn't JSON).
 */
function decode(bytes: Buffer): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff){
        // big-endian: swapped into little-endian (a trailing odd byte can't be a character), so no ICU encoding is needed
        const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2))).swap16();
        return new TextDecoder("utf-16le").decode(swapped);
    }
    return new TextDecoder("utf-8").decode(bytes);   // drops a leading mark, as the decoder does by default
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
