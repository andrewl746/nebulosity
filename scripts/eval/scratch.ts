/**
 * What a run left in its scratch folder (Eval #2's scripts, R6), kept beside its raw transcript: copied, then the temp
 * folder removed. It runs in the runner's `finally`, after a run was kept or while a Stop is on its way out, so it never
 * throws (a throw there would replace the Stop and skip the removal), never follows a link (a link could point anywhere on
 * the machine: its target is neither copied nor removed), and copies at most `limitBytes` (a run could write gigabytes).
 * Whatever it leaves out, and a copy that fails, is recorded in the result and, when it can be written, in ARCHIVE-NOTE.txt
 * inside the archive.
 */
import fs from "fs";
import path from "path";

/** 50 MB: a probe script and its output are kilobytes, so the cap only stops a run that wrote far more. */
export const SCRATCH_ARCHIVE_LIMIT = 50 * 1024 * 1024;

export type ArchiveResult = {
    /** The files copied and their bytes. */
    files: number; bytes: number;
    /** Each path (relative to the scratch folder) left out, with why. */
    leftOut: string[];
    /** Why the copy stopped, or null. */
    failure: string | null;
    /** Whether the scratch folder is gone. */
    removed: boolean;
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/** Copies `from` into `to` (made fresh), entries in name order, links left out, files while the total fits. */
function copyTree(from: string, to: string, rel: string, result: ArchiveResult, limitBytes: number): void {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()){
        const [source, target, shown] = [path.join(from, name), path.join(to, name), rel === "" ? name : `${rel}/${name}`];
        // lstat, so a link (a junction on Windows) is seen as the link itself
        const stat = fs.lstatSync(source);
        if (stat.isSymbolicLink()) result.leftOut.push(`${shown} (a link, not followed)`);
        else if (stat.isDirectory()) copyTree(source, target, shown, result, limitBytes);
        else if (!stat.isFile()) result.leftOut.push(`${shown} (not a file or a folder)`);
        else if (result.bytes + stat.size > limitBytes) result.leftOut.push(`${shown} (${stat.size} bytes: past the archive's cap of ${limitBytes} bytes)`);
        else {
            fs.copyFileSync(source, target);
            result.files++;
            result.bytes += stat.size;
        }
    }
}

/** Archives the scratch folder `from` into `to`, then removes `from`. Never throws: everything that went wrong is in the result. */
export function archiveScratch(from: string, to: string, limitBytes: number = SCRATCH_ARCHIVE_LIMIT): ArchiveResult {
    const result: ArchiveResult = { files: 0, bytes: 0, leftOut: [], failure: null, removed: false };
    try{
        copyTree(from, to, "", result, limitBytes);
    } catch(e){
        result.failure = `the scratch folder couldn't be archived: ${messageOf(e)}`;
    }
    if (result.leftOut.length > 0 || result.failure !== null){
        try{
            const lines = [...result.leftOut.map((l) => `- ${l}`), ...(result.failure === null ? [] : [`- ${result.failure}`])];
            fs.writeFileSync(path.join(to, "ARCHIVE-NOTE.txt"), `Left out of this archive of the run's scratch folder:\n${lines.join("\n")}\n`);
        } catch{
            // the archive's folder itself couldn't be made: the result still says so
        }
    }
    try{
        // rmSync removes a link inside the folder as a link: what it points at stays
        fs.rmSync(from, { recursive: true, force: true });
        result.removed = !fs.existsSync(from);
    } catch(e){
        const why = `the scratch folder couldn't be removed: ${messageOf(e)}`;
        result.failure = result.failure === null ? why : `${result.failure}; ${why}`;
    }
    return result;
}
