import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import fs from "fs";
import os from "os";
import * as vscode from "vscode";
import { findOnPath, nebulosityLaunch, withArgs, type Launch } from "./command";
import { getJson, mapUrl, RefusedError, TimeoutError } from "./http";
import { choosePort, parsePrintedPort } from "./ports";
import { classifyRepos, type ServerCheck } from "./serverCheck";

/**
 * Finding or starting the Map (design §4.2, V1.8 plan P2, P14). The port comes from the `nebulosity.port` setting, else
 * from `nebulosity map --print-port` (the port the Map was last started on), else 3000. One `GET /api/repos` tells
 * whether a Map runs there, which version, or another app. When nothing listens, the extension starts
 * `nebulosity map --port <port>` itself, and it's the only Map this window ever stops: on Stop Map, and when the window
 * closes (deactivate). A Map started anywhere else is never stopped from here.
 */

/** How long one probe of `/api/repos` may take (design §4.2 step 2). */
export const PROBE_TIMEOUT_MS = 1_000;
/** The start poll (design §4.2 step 3): a cold `next start` on a slow machine can take most of a minute. */
export const START_POLL_MS = 500;
export const START_TIMEOUT_MS = 60_000;
/** `--print-port` boots tsx and reads one file: about half a second. */
const PRINT_PORT_TIMEOUT_MS = 5_000;
/** How long Stop waits for the process tree to go before it gives up waiting (deactivate is waited on, not forever). */
const STOP_WAIT_MS = 3_000;
/** How much of the Map's output is kept to find its last line (the message when it fails). */
const TAIL_LENGTH = 4_000;

export type Found = { port: number; check: ServerCheck } | { notInstalled: true };

/** The Map was stopped (Stop Map, or the window closing) while it was starting. */
export class StoppedError extends Error {
    constructor(){
        super("The Map was stopped.");
        this.name = "StoppedError";
    }
}

/**
 * Starts a launch with more arguments, quoted as `withArgs` quotes them. Through a shell, the line is joined here and
 * spawned as one string, as scripts/cli.ts' runClaude does: Node joins an args array with spaces anyway, and Node 24
 * warns (DEP0190) when one is passed with `shell: true`.
 */
function spawnLaunch(launch: Launch, args: string[], options: SpawnOptions): ChildProcess {
    const line = withArgs(launch, args);
    return line.shell ? spawn([line.command, ...line.args].join(" "), { ...options, shell: true }) : spawn(line.command, line.args, options);
}

/**
 * Ends a process and everything it started. On Windows the child is cmd.exe (or the .exe), with node and `next start`
 * below it, so taskkill takes the tree (/T) by force (/F). Elsewhere the child leads its own process group (it was
 * spawned detached), and the group is sent SIGTERM, then SIGKILL if it's still there when the wait ends.
 */
function killTree(pid: number): void {
    if (process.platform === "win32"){
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
        return;
    }
    try{
        process.kill(-pid, "SIGTERM");
    } catch{
        // the group is gone already
    }
}

/** The last non-empty line of some output, without terminal colour codes. */
function lastLineOf(text: string): string {
    const lines = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    return lines.length === 0 ? "" : lines[lines.length - 1];
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Who answers on the port: a ServerCheck, or "refused" (nothing listens) or "timeout" (something listens and doesn't answer yet). */
async function probe(port: number): Promise<ServerCheck | "refused" | "timeout"> {
    try{
        const answer = await getJson(mapUrl(port, "/api/repos"), PROBE_TIMEOUT_MS);
        return classifyRepos(answer.status, answer.body);
    } catch (err){
        if (err instanceof RefusedError) return "refused";
        if (err instanceof TimeoutError) return "timeout";
        throw err;
    }
}

export class MapServer {
    /** The Map this window started, while it runs. */
    private child: ChildProcess | null = null;
    /** Its port: a Map started here on another port is stopped before one starts on the new port. */
    private childPort: number | null = null;
    /** `--print-port`'s answer, asked once per window and kept (P2); undefined until asked. */
    private printed: number | null | undefined = undefined;
    /** The ensure in flight, so two Show Maps never start two Maps. */
    private ensuring: Promise<Found> | null = null;
    /** The end of the output of the Maps started here. */
    private tail = "";
    /** The Maps stop() ended, so a start it interrupted fails as stopped, not as a crash. */
    private readonly stopping = new WeakSet<ChildProcess>();

    constructor(readonly output: vscode.OutputChannel){}

    /** True while a Map this window started is running (or starting). */
    get startedByUs(): boolean {
        return this.child !== null;
    }

    /** One line in the Output channel, marked as the extension's own (the Map's lines come as it prints them). */
    log(line: string): void {
        this.output.appendLine(`[extension] ${line}`);
    }

    /**
     * What runs `nebulosity`: the `nebulosity.command` setting, else `nebulosity` on PATH, else null (not installed).
     * A setting that can't be run says so in the Output channel.
     */
    launch(): Launch | null {
        const setting = vscode.workspace.getConfiguration("nebulosity").get<string>("command") ?? "";
        const launch = nebulosityLaunch(setting, findOnPath("nebulosity", process.env, process.platform, fs.existsSync), process.platform, fs.existsSync);
        if (launch === null && setting.trim() !== ""){
            this.log(`The nebulosity.command setting ("${setting}") can't be run: on Windows it must name a .cmd, .bat or .exe file, or a checkout's bin/nebulosity.mjs.`);
        }
        return launch;
    }

    /**
     * Finds the Map, or starts it. `onStart` is called just before this window starts one (the panel then says
     * "Starting the Map…"). Throws when a Map started here fails (the message is its output's last line), and
     * StoppedError when Stop came first.
     */
    ensure(onStart?: () => void): Promise<Found> {
        if (this.ensuring !== null) return this.ensuring;
        const ensuring: Promise<Found> = this.find(onStart).finally(() => {
            // stop() may have let this one go and a newer one started since
            if (this.ensuring === ensuring) this.ensuring = null;
        });
        this.ensuring = ensuring;
        return ensuring;
    }

    private async find(onStart?: () => void): Promise<Found> {
        const launch = this.launch();
        if (launch === null) return { notInstalled: true };
        const port = await this.portFor(launch);

        const first = await probe(port);
        if (first !== "refused" && first !== "timeout"){
            this.log(`Port ${port} answers: ${first.kind === "current" ? "a Map" : first.kind === "foreign" ? "another app" : `a Map this extension can't use (${first.kind})`}.`);
            return { port, check: first };
        }
        onStart?.();
        // our own Map on this port, still coming up: wait for it rather than start a second one
        if (this.child !== null && this.childPort === port) return { port, check: await this.waitFor(port, this.child) };
        // something holds the port and doesn't answer yet (a Map another window just started, say): wait for it
        if (first === "timeout") return { port, check: await this.waitFor(port, null) };
        // the port setting moved since this window started a Map: that one goes, so nothing is left running unowned
        if (this.child !== null) await this.release();
        return { port, check: await this.waitFor(port, this.start(launch, port)) };
    }

    /** The port setting when it's a port, else the printed one (asked once), else 3000. */
    private async portFor(launch: Launch): Promise<number> {
        const raw = vscode.workspace.getConfiguration("nebulosity").get<unknown>("port");
        // a hand-edited setting can hold anything: only a whole number from 1 to 65535 is a port
        const setting = typeof raw === "number" ? parsePrintedPort(String(raw)) : null;
        if (raw !== null && raw !== undefined && setting === null) this.log(`The nebulosity.port setting (${JSON.stringify(raw)}) isn't a port from 1 to 65535, so it's left out.`);
        if (setting !== null) return setting;
        // undefined until asked: a null answer is kept too, so a Nebulosity without the flag isn't asked again
        if (this.printed === undefined) this.printed = await this.printPort(launch);
        return choosePort(null, this.printed);
    }

    /** `nebulosity map --print-port`'s answer, or null when it gives none in time (an older Nebulosity refuses the flag). */
    private printPort(launch: Launch): Promise<number | null> {
        return new Promise((resolve) => {
            let child: ChildProcess;
            try{
                // detached on macOS and Linux like the Map itself, so killTree can end its group if it hangs
                child = spawnLaunch(launch, ["map", "--print-port"], {
                    cwd: os.homedir(),
                    detached: process.platform !== "win32",
                    windowsHide: true,
                    stdio: ["ignore", "pipe", "pipe"],
                });
            } catch (err){
                this.log(`nebulosity map --print-port didn't run: ${err instanceof Error ? err.message : String(err)}`);
                resolve(null);
                return;
            }
            let stdout = "";
            let stderr = "";
            const timer = setTimeout(() => {
                if (child.pid !== undefined) killTree(child.pid);
                this.log(`nebulosity map --print-port didn't answer in ${PRINT_PORT_TIMEOUT_MS / 1000} s.`);
                resolve(null);
            }, PRINT_PORT_TIMEOUT_MS);
            child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
            child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
            child.on("error", (err) => {
                clearTimeout(timer);
                this.log(`nebulosity map --print-port didn't run: ${err.message}`);
                resolve(null);
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                const port = code === 0 ? parsePrintedPort(stdout) : null;
                if (port === null) this.log(`nebulosity map --print-port gave no port${stderr.trim() !== "" ? `: ${lastLineOf(stderr)}` : ""}.`);
                resolve(port);
            });
        });
    }

    /** Starts `nebulosity map --port <port>`, its output in the Output channel. */
    private start(launch: Launch, port: number): ChildProcess {
        const line = withArgs(launch, ["map", "--port", String(port)]);
        this.log(`Starting the Map: ${[line.command, ...line.args].join(" ")}`);
        this.tail = "";
        const child = spawnLaunch(launch, ["map", "--port", String(port)], {
            cwd: os.homedir(),                       // never a workspace folder, which a running process would hold open on Windows
            detached: process.platform !== "win32",  // its own process group, so Stop ends the whole tree (killTree)
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const append = (text: string): void => {
            this.output.append(text);
            this.tail = (this.tail + text).slice(-TAIL_LENGTH);
        };
        // decoded as UTF-8 by the stream, so a character split across two chunks (next's ▲ and ✓) comes out whole
        child.stdout?.setEncoding("utf8").on("data", append);
        child.stderr?.setEncoding("utf8").on("data", append);
        const gone = (): void => {
            if (this.child !== child) return;
            this.child = null;
            this.childPort = null;
        };
        // a spawn that fails (no such program) may never emit exit, so an error lets go of the child too
        child.on("error", (err) => {
            gone();
            this.log(`nebulosity map didn't run: ${err.message}`);
        });
        child.on("exit", (code, signal) => {
            gone();
            this.log(`The Map stopped (${signal !== null ? `signal ${signal}` : `exit code ${code}`}).`);
        });
        this.child = child;
        this.childPort = port;
        return child;
    }

    /**
     * Polls `/api/repos` every 500 ms for up to 60 s until the port answers. With `child` (a Map started here), its
     * early end fails the wait with its output's last line. A Map started here that never answers is stopped.
     */
    private async waitFor(port: number, child: ChildProcess | null): Promise<ServerCheck> {
        let ended: Error | null = null;
        const onEnd = (code: number | null): void => {
            ended = child !== null && this.stopping.has(child)
                ? new StoppedError()
                : new Error(lastLineOf(this.tail) || `nebulosity map stopped with exit code ${code}.`);
        };
        const onError = (err: Error): void => {
            ended = new Error(`nebulosity map didn't run: ${err.message}`);
        };
        // close, not exit: by then the output is all in, so its last line is the real one
        child?.on("close", onEnd);
        child?.on("error", onError);
        try{
            const deadline = Date.now() + START_TIMEOUT_MS;
            while (Date.now() < deadline){
                if (ended !== null) throw ended;
                const answer = await probe(port);
                if (answer !== "refused" && answer !== "timeout") return answer;
                await delay(START_POLL_MS);
            }
            if (ended !== null) throw ended;
        } finally{
            child?.off("close", onEnd);
            child?.off("error", onError);
        }
        if (child !== null && this.child === child) await this.release();
        throw new Error(`The Map didn't answer on port ${port} within ${START_TIMEOUT_MS / 1000} s.`);
    }

    /**
     * Ends the Map this window started, and the processes it started, then waits (at most 3 s) for it to go. Does nothing
     * for a Map started elsewhere. deactivate returns this promise, so VS Code waits for the tree to go. A start it
     * interrupts fails with StoppedError, and the next ensure starts afresh rather than joining that one.
     */
    stop(): Promise<void> {
        if (this.child === null) return Promise.resolve();
        this.ensuring = null;
        return this.release();
    }

    /** Ends the Map started here, from inside an ensure as well (which stop() would let go of). */
    private release(): Promise<void> {
        const child = this.child;
        if (child === null) return Promise.resolve();
        this.child = null;
        this.childPort = null;
        this.stopping.add(child);
        if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve();
        const pid = child.pid;
        this.log("Stopping the Map this window started.");
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // still there: on macOS and Linux the group gets the signal that can't be caught
                if (process.platform !== "win32"){
                    try{
                        process.kill(-pid, "SIGKILL");
                    } catch{
                        // gone between the check and the kill
                    }
                }
                resolve();
            }, STOP_WAIT_MS);
            child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
            killTree(pid);
        });
    }
}
