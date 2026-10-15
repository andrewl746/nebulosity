import { dataPath } from "./home";

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
