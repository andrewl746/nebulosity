import { runSummarize } from "./commands/summarize-command";
void runSummarize(process.argv.slice(2)).then((code) => { process.exitCode = code; });
