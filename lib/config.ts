import { randomBytes } from "crypto";
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
    return interpret(file, readRaw(file));
}

/** What one read of config.json gave: no file, its bytes, or the error. */
type RawRead = { kind: "missing" } | { kind: "bytes"; bytes: Buffer } | { kind: "error"; error: unknown };

function readRaw(file: string): RawRead {
    try{
        return { kind: "bytes", bytes: fs.readFileSync(file) };
    } catch (err){
        return codeOf(err) === "ENOENT" ? { kind: "missing" } : { kind: "error", error: err };
    }
}

/** readConfigFile's reading of one raw read. */
function interpret(file: string, read: RawRead): ConfigRead {
    const defaults = (problem: string | null = null): ConfigRead => ({ config: { activeRepo: null, port: DEFAULT_PORT }, problem });
    if (read.kind === "missing") return defaults();   // nothing chosen yet
    if (read.kind === "error") return defaults(`${file} couldn't be read (${messageOf(read.error)})`);

    const text = decode(read.bytes);
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
    // Everything else as found: the Map's repo picker and `nebulosity index` rewrite the file through
    // updateConfig((current) => ({ ...current, activeRepo })), and that must keep summaryModels (Review Focus 1).
    return { config: { ...found, activeRepo: typeof found.activeRepo === "string" ? found.activeRepo : null, port }, problem: null };
}

/** Thrown by updateConfig when config.json kept failing to read: it might hold settings, so nothing is written over it. */
export class ConfigUnreadableError extends Error {
    constructor(file: string, cause: unknown){
        super(`${file} couldn't be read to change it (${messageOf(cause)}), so nothing was written; try again`, { cause });
        this.name = "ConfigUnreadableError";
    }
}

/**
 * Read errors that usually pass: Windows answers EBUSY or EPERM while a scanner or another program holds the file, and
 * EACCES for some of the same. updateConfig tries such a read READ_TRIES times, RETRY_MS apart, before it gives up.
 */
const TRANSIENT: ReadonlySet<string> = new Set(["EBUSY", "EPERM", "EACCES", "EAGAIN"]);
const READ_TRIES = 5;
const RETRY_MS = 40;
/** How often updateConfig reads again after another writer moved the broken file away first. */
const MOVED_AWAY_TRIES = 3;

/**
 * Changes the settings in one read-modify-write (Final Review #2's minor 1, ruling R30): `change` gets what this one read
 * of config.json found and returns the settings to write, or null for none. The merge and the check that the file can be
 * written over come from that same read, so nothing else can slip in between them. Every writer goes through here.
 * - A read that fails (other than a missing file) is tried again briefly; one that keeps failing throws
 *   ConfigUnreadableError and writes nothing, since the file may hold valid settings (a scanner's EBUSY on Windows).
 * - A file that's there but isn't one JSON object (readConfigFile's `problem`) is never written over (R25): it's renamed
 *   to `config.json.invalid-<time>-<pid>-<random>` beside it first, and `say` (stderr by default) says where, so a hand
 *   edit with a typo survives the next repo pick or index run. Two writers can't pick one name. When the rename finds
 *   the file gone, another writer moved it first: the file is read again, and `change` runs on what that writer saved,
 *   so `change` has to be pure.
 * - The new file goes to a temporary file beside it, renamed into place, so a reader never sees half of it. A rename that
 *   fails throws (after the same brief retries), and the old file stays whole.
 * Returns the moved-aside file's path, or null when nothing was moved.
 */
export function updateConfig(
    change: (current: NebulosityConfig) => NebulosityConfig | null, say: (message: string) => void = (message) => console.error(message)
): string | null {
    const file = configPath();
    for (let attempt = 1; ; attempt++){
        const raw = retrying(() => {
            const read = readRaw(file);
            if (read.kind === "error") throw read.error;
            return read;
        }, (err) => { throw new ConfigUnreadableError(file, err); });
        const { config, problem } = interpret(file, raw);
        const next = change(config);
        if (next === null) return null;

        fs.mkdirSync(path.dirname(file), { recursive: true });
        let aside: string | null = null;
        if (problem !== null){
            aside = movedAsidePath(file);
            try{
                fs.renameSync(file, aside);
            } catch (err){
                if (codeOf(err) === "ENOENT" && attempt < MOVED_AWAY_TRIES) continue;   // moved by another writer: read what it saved
                throw err;
            }
            say(`[nebulosity] ${problem}, so it was moved aside to ${aside} before the settings were written again; copy what you need from it into ${file}, then delete it`);
        }
        writeAtomically(file, next);
        return aside;
    }
}

/** Replaces the whole settings file with `config` (updateConfig, which moves a file it can't read aside first). To change one setting, use updateConfig. */
export function writeConfig(config: NebulosityConfig, say?: (message: string) => void): string | null {
    return updateConfig(() => config, say);
}

/** Writes beside the file, then renames over it: a reader sees the old settings or the new, never half. */
function writeAtomically(file: string, config: NebulosityConfig): void {
    const temp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n");
    retrying(() => fs.renameSync(temp, file), (err) => {
        fs.rmSync(temp, { force: true });
        throw err;
    });
}

/** Runs `attempt` until it succeeds, retrying a transient error (TRANSIENT) up to READ_TRIES times; else `fail` with the error. */
function retrying<T>(attempt: () => T, fail: (err: unknown) => never): T {
    for (let tries = 1; ; tries++){
        try{
            return attempt();
        } catch (err){
            if (tries >= READ_TRIES || !TRANSIENT.has(codeOf(err) ?? "")) return fail(err);
            // a synchronous pause: the CLI and the worker write the config between steps, never on a hot path
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_MS);
        }
    }
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

/**
 * `config.json.invalid-2026-10-25T13-50-12-345Z-4120-9f3a1c07`: the time without colons, which Windows forbids in a name,
 * then the process id and 8 random hex digits, so two writers moving files aside in the same millisecond never pick one
 * name (a rename onto an existing file replaces it, on Windows and POSIX alike). Sorting by name is still by time.
 */
function movedAsidePath(file: string): string {
    return `${file}${MOVED_ASIDE_MARK}${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

/**
 * The file's text: UTF-16 when its byte-order mark leads (little- or big-endian), else UTF-8 with any leading mark
 * dropped. JSON.parse would refuse the mark itself (a string that starts with U+FEFF isn't JSON).
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

function codeOf(err: unknown): string | undefined {
    return (err as NodeJS.ErrnoException | null)?.code;
}
