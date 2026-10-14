/**
 * The git user.email, for the leak scans (D7: the demo and the eval transcripts must never publish it). Three scripts
 * read it, so they share this. It tells "git ran and no email is set" (null: nothing to scan for) from "git couldn't be
 * asked" (a warning that the scan lost its email layer): treating both as null let build-demo print "ready" after
 * checking for nothing.
 */
import { spawnSync } from "child_process";

/** The part of spawnSync's answer the decision reads. */
export type GitRun = { status: number | null; signal?: string | null; stdout?: string | null; stderr?: string | null; error?: Error };

export type EmailReading = { ok: true; email: string | null } | { ok: false; reason: string };

/**
 * `git config user.email` exits 0 and prints the address; exits 1 and prints nothing when the key isn't set. Any other
 * outcome (git missing, a broken config file, a signal) means git couldn't say.
 */
export function readEmail(run: GitRun): EmailReading {
    if (run.error) return { ok: false, reason: `git couldn't run: ${run.error.message}` };
    if (run.status === null) return { ok: false, reason: `git was stopped by ${run.signal ?? "a signal"}` };
    const printed = (run.stdout ?? "").trim();
    if (run.status === 0 || (run.status === 1 && printed === "")) return { ok: true, email: printed || null };
    const complaint = (run.stderr ?? "").trim().split("\n")[0];
    return { ok: false, reason: `git exited with status ${run.status}${complaint ? `: ${complaint}` : ""}` };
}

export const emailWarning = (script: string, reason: string): string =>
    `[${script}] git user.email couldn't be read (${reason}): the scan won't check for an email`;

/** The email, or null (with a warning on stderr when git couldn't be asked). `cwd` picks the repository whose config applies. */
export function gitEmail(script: string, cwd?: string): string | null {
    const reading = readEmail(spawnSync("git", ["config", "user.email"], { encoding: "utf8", cwd }));
    if (!reading.ok){
        console.warn(emailWarning(script, reading.reason));
        return null;
    }
    return reading.email;
}
