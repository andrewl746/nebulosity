import { dataPath } from "./home";

/**
 * The install line that works on every npm (ADR-058, amended 2026-11-07). npm 12 blocks dependencies' install scripts
 * unless they're allowed, and better-sqlite3's builds the database engine. An older npm runs them anyway and only warns
 * that it doesn't know the flag.
 */
export const INSTALL_COMMAND = "npm install -g --allow-scripts=better-sqlite3,onnxruntime-node,protobufjs,esbuild nebulosity";

/**
 * A Nebulosity command as a message tells a user to run it (ADR-058): the installed `nebulosity` command, and a
 * checkout's npm script beside it, since a message reaches users of both. `args` as typed, e.g. `"<path-to-repo>"`.
 */
export function commandHint(command: "index" | "summarize", args: string): string {
    return `nebulosity ${command} ${args} (in a checkout: npm run ${command} -- ${args})`;
}

/**
 * Where ANTHROPIC_API_KEY goes, after "ANTHROPIC_API_KEY is not set": the environment the command or the Map starts in,
 * or the .env.local in Nebulosity's data folder, which the CLI, the Map's server and its background worker all read
 * (scripts/env.ts, instrumentation.ts).
 */
export function keyHint(): string {
    return `set it in the environment, or put it in ${dataPath(".env.local")}`;
}
