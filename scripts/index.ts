import { runIndex } from "./commands/index-command";

// an error runIndex doesn't turn into an exit code rejects, and Node reports it and exits non-zero, as a throw did
void runIndex(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
