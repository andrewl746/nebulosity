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

/**
 * The name Claude Code gives a project's folder under ~/.claude/projects/: the folder with every character that isn't
 * a letter or a digit turned into "-" (C:/Users/Ann becomes C--Users-Ann). A stream-json transcript names it, in the
 * init message's memory_paths and in the paths of tool results, and it holds the folder as plainly as a spelling does.
 */
export function slug(folder: string): string {
    return folder.replace(/\\/g, "/").replace(/\/+$/, "").replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * The needles for some folders (each one's spellings and its slug) and an email, longest first, so a report names the
 * most specific match. With `home` (the user's home folder, scanned for too), each folder inside it adds one more: the
 * home's last segment and the folder's first segment below it ("ann/projects" for C:/Users/Ann/Projects/app). A path
 * cut off at its front still holds that pair: a script that prints `path.slice(n)` writes "ers/Ann/Projects/app/x.ts",
 * which no whole-folder spelling matches. findLeak compares it in canonical form, so any separator or escape counts.
 */
export function leakNeedles(input: { folders: readonly string[]; email?: string | null; home?: string | null }): string[] {
    const folders = input.home ? [input.home, ...input.folders] : input.folders;
    // spellings() first: it refuses a folder too shallow to scan for, and its slug would be as greedy
    const needles = new Set(folders.flatMap((folder) => [...spellings(folder), slug(folder).toLowerCase()]));
    if (input.home) for (const needle of homeSegmentNeedles(input.home, input.folders)) needles.add(needle);
    if (input.email) needles.add(input.email.toLowerCase());
    return [...needles].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** "<home's last segment>/<first segment below home>" for each folder inside home, lowercased; none for home itself. */
function homeSegmentNeedles(home: string, folders: readonly string[]): string[] {
    const forward = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const base = forward(home);
    const user = base.slice(base.lastIndexOf("/") + 1);
    return folders
        .map(forward)
        .filter((folder) => folder.startsWith(`${base}/`))
        .map((folder) => `${user}/${folder.slice(base.length + 1).split("/")[0]}`);
}

/**
 * A text in one spelling, for a match that doesn't care how a path was written or escaped: lowercased, with %5c and
 * %2f turned into "/", %3a into ":" and %40 into "@", and every run of "\" and "/" folded into a single "/". A path
 * escaped twice (JSON inside JSON), three times or more, with its slashes mixed, or with only its colon encoded
 * (file:///c%3A/...) comes out the same as the plain one.
 */
function canonical(text: string): string {
    return text
        .toLowerCase()
        .replace(/%5c|%2f/g, "/")
        .replace(/%3a/g, ":")
        .replace(/%40/g, "@")
        .replace(/[\\/]+/g, "/");
}

/**
 * The first needle a text holds, ignoring case, or null. It looks for each needle as written first. Only when none is
 * there does it look again at both in canonical form, so a deeper escape than the spellings cover still counts. It
 * returns the needle as it was given, never its canonical form. The match is a substring, with no check that it ends at
 * a path segment: for a leak scanner, a false report is the safe mistake.
 */
export function findLeak(text: string, needles: readonly string[]): string | null {
    const lower = text.toLowerCase();
    const exact = needles.find((needle) => lower.includes(needle.toLowerCase()));
    if (exact !== undefined) return exact;
    const folded = canonical(text);
    return needles.find((needle) => folded.includes(canonical(needle))) ?? null;
}

/**
 * Every file under a folder that holds a needle, by path relative to the folder. Each file is read as UTF-8, as latin1
 * and as latin1 with its NULs removed, so a needle is found in text with any non-ASCII name, in binary files, and in
 * UTF-16 text (either byte order, with a BOM or without; Windows PowerShell 5.1's > writes it), which has a NUL beside
 * every ASCII character. It throws with no needles, because scanning for nothing would call every folder clean.
 */
export function scanForLeaks(dir: string, needles: readonly string[]): Leak[] {
    if (needles.length === 0) throw new Error("nothing to scan for: no needles were given");
    const leaks: Leak[] = [];
    const walk = (folder: string): void => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })){
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()){
                walk(full);
                continue;
            }
            const bytes = fs.readFileSync(full);
            const latin1 = bytes.toString("latin1");
            const needle = findLeak(bytes.toString("utf8"), needles) ?? findLeak(latin1, needles) ?? findLeak(latin1.replace(/\0/g, ""), needles);
            if (needle !== null) leaks.push({ file: path.relative(dir, full).replace(/\\/g, "/"), needle });
        }
    };
    walk(dir);
    return leaks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
