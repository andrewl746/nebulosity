/**
 * How the extension starts `nebulosity` (Review Focus 3): which file to run, whether it needs a shell, and its arguments
 * quoted for that shell. Everything here takes the environment, the platform and a file check as arguments, so the
 * Windows rules can be tested on any system.
 */

/** A program to spawn. `shell` is true when it must run through cmd.exe: a .cmd or .bat file, or `node` on Windows. */
export type Launch = { command: string; args: string[]; shell: boolean };

/** Windows' default when PATHEXT isn't set. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** cmd.exe gives these a meaning of their own outside double quotes (a space splits the argument). */
const CMD_SPECIAL = /[ &()^"]/;

/**
 * An environment variable by name. Windows' names are case-insensitive: Node's own process.env reads them that way,
 * but a copied environment object doesn't, and Windows usually spells this one "Path".
 */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
    if (platform !== "win32") return env[name];
    const key = Object.keys(env).find((k) => k.toUpperCase() === name);
    return key === undefined ? undefined : env[key];
}

/**
 * The first `name` on PATH that `exists`, or null. On Windows it reads Path (or PATH), split at ";", and tries the name
 * with each PATHEXT extension, never the bare name: npm puts an extensionless sh script beside nebulosity.cmd, which
 * Windows can't run. Elsewhere it reads PATH, split at ":", and tries the bare name.
 */
export function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean): string | null {
    const windows = platform === "win32";
    const dirs = (envValue(env, "PATH", platform) ?? "").split(windows ? ";" : ":")
        // a Windows PATH entry may be quoted; an empty entry (the current folder on POSIX) is skipped
        .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
        .filter((dir) => dir !== "");
    const extensions = windows
        ? (envValue(env, "PATHEXT", platform) ?? DEFAULT_PATHEXT).split(";").map((ext) => ext.trim()).filter((ext) => ext !== "")
        : [""];
    const separator = windows ? "\\" : "/";

    for (const dir of dirs){
        const base = dir.endsWith(separator) || dir.endsWith("/") ? dir.slice(0, -1) : dir;
        for (const ext of extensions){
            const candidate = `${base}${separator}${name}${ext}`;
            if (exists(candidate)) return candidate;
        }
    }
    return null;
}

/** The extension of a path's last segment, lower-cased (".cmd"), or "" when it has none. */
function extensionOf(file: string): string {
    const name = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * What to spawn for `nebulosity`: the `nebulosity.command` setting when it's set, else what findOnPath gave, else null.
 * - A .mjs or .js file is a checkout's `bin/nebulosity.mjs`: it runs with the `node` on PATH (never the extension
 *   host's own process.execPath, which is Electron), through the shell on Windows.
 * - Anything else is the command itself. On Windows a .cmd or .bat needs the shell, and a name with no extension (npm's
 *   sh script) is taken as its .cmd, then its .exe, or refused (null) when neither exists.
 */
export function nebulosityLaunch(setting: string, onPath: string | null, platform: NodeJS.Platform, exists: (p: string) => boolean): Launch | null {
    const chosen = setting.trim() !== "" ? setting.trim() : onPath;
    if (chosen === null) return null;
    const windows = platform === "win32";
    const ext = extensionOf(chosen);

    if (ext === ".mjs" || ext === ".js") return { command: "node", args: [chosen], shell: windows };
    if (!windows) return { command: chosen, args: [], shell: false };
    if (ext === ""){
        for (const tried of [".cmd", ".exe"]){
            if (exists(`${chosen}${tried}`)) return { command: `${chosen}${tried}`, args: [], shell: tried === ".cmd" };
        }
        return null;
    }
    return { command: chosen, args: [], shell: ext === ".cmd" || ext === ".bat" };
}

/**
 * One argument as cmd.exe and then the program read it. Inside double quotes cmd.exe takes `&()^` and spaces as text.
 * The program (Node, through the .cmd shim) then splits its command line by the C runtime's rules, where backslashes
 * before a quote escape it, so the trailing ones are doubled and `"C:\dir\"` still ends at its closing quote. A `"` of
 * its own (never in a Windows path) is doubled, which keeps cmd.exe inside the quotes.
 */
function quoteForCmd(arg: string): string {
    if (arg === "") return '""';                    // unquoted, an empty argument would vanish from the line
    if (!CMD_SPECIAL.test(arg)) return arg;
    return `"${arg.replace(/"/g, '""').replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * The launch with `args` added after its own. With `shell` true, the command and every argument holding a space or one
 * of `&()^"` are double-quoted, because Node's spawn with `shell: true` joins them into one cmd.exe command line as they
 * are. Only for child_process.spawn with `shell: true`: a VS Code ShellExecution quotes for the user's own shell, so it
 * gets the unquoted Launch. Call it once per spawn: the Launch it gives is quoted already, and a second call quotes again.
 */
export function withArgs(launch: Launch, args: string[]): Launch {
    const all = [...launch.args, ...args];
    if (!launch.shell) return { command: launch.command, args: all, shell: false };
    return { command: quoteForCmd(launch.command), args: all.map(quoteForCmd), shell: true };
}
