/**
 * A Nebulosity command as a message tells a user to run it (ADR-058): the installed `nebulosity` command, and a
 * checkout's npm script beside it, since a message reaches users of both. `args` as typed, e.g. `"<path-to-repo>"`.
 */
export function commandHint(command: "index" | "summarize", args: string): string {
    return `nebulosity ${command} ${args} (in a checkout: npm run ${command} -- ${args})`;
}
