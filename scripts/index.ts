import { runIndex } from "./commands/index-command";
process.exitCode = runIndex(process.argv.slice(2));
