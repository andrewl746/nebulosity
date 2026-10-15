#!/usr/bin/env node
// The `nebulosity` command (ADR-058): plain JavaScript, so node runs it on every system. boot.mjs loads tsx from the
// package and keeps an installed copy's data in the user's data folder (ADR-044, amended), as mcp/launch.mjs does;
// then scripts/cli.ts takes over.
import { boot } from "./boot.mjs";

await boot();
const { main } = await import("../scripts/cli.ts");
process.exitCode = await main(process.argv.slice(2));
