import fs from "fs";
import path from "path";

/** A file in a folder about to be published that holds a path of this machine, or the owner's email. */
export type Leak = { file: string; needle: string };

/**
 * Every way an absolute folder can show up in a file, lowercased for a case-blind match: forward slashes, backslashes,
 * backslashes as JSON escapes them, URL-encoded either way, and Git Bash's /c/… for a drive path. A folder shallower
 * than two segments is refused: "C:/" would match every Windows path (D7).
 */
export function spellings(folder: string): string[] {
    const forward = folder.replace(/\\/g, "/").replace(/\/+$/, "");
    if (forward.split("/").filter(Boolean).length < 2) throw new Error(`"${folder}" is too shallow to scan for: it would match everything`);
    const back = forward.replace(/\//g, "\\");
    const forms = [forward, back, back.replace(/\\/g, "\\\\"), encodeURIComponent(forward), encodeURIComponent(back)];
    const drive = /^([a-zA-Z]):\//.exec(forward);
    if (drive) forms.push(`/${drive[1]}/${forward.slice(3)}`);
    return [...new Set(forms.map((f) => f.toLowerCase()))];
}

/** The needles for some folders and an email, longest first, so a report names the most specific match. */
export function leakNeedles(input: { folders: readonly string[]; email?: string | null }): string[] {
    const needles = new Set(input.folders.flatMap((folder) => spellings(folder)));
    if (input.email) needles.add(input.email.toLowerCase());
    return [...needles].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** The first needle a text holds, ignoring case, or null. */
export function findLeak(text: string, needles: readonly string[]): string | null {
    const lower = text.toLowerCase();
    return needles.find((needle) => lower.includes(needle)) ?? null;
}

/**
 * Every file under a folder that holds a needle, by path relative to the folder. Each file is read as UTF-8 and as
 * latin1, so a needle is found in text with any non-ASCII name and in binary files alike.
 */
export function scanForLeaks(dir: string, needles: readonly string[]): Leak[] {
    const leaks: Leak[] = [];
    const walk = (folder: string): void => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })){
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()){
                walk(full);
                continue;
            }
            const bytes = fs.readFileSync(full);
            const needle = findLeak(bytes.toString("utf8"), needles) ?? findLeak(bytes.toString("latin1"), needles);
            if (needle !== null) leaks.push({ file: path.relative(dir, full).replace(/\\/g, "/"), needle });
        }
    };
    walk(dir);
    return leaks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
