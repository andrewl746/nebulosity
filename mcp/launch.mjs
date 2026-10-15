// The command an MCP client runs: `node <checkout>/mcp/launch.mjs` (ADR-048, API_CONTRACTS.md §17).
// Plain JavaScript, so node runs it directly: no npx (which needs `cmd /c` on Windows) and no build step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Nebulosity's own files (the database, the migrations, the config) live in the checkout this file sits in, wherever
// the client starts us: Claude Code starts MCP servers in the user's project folder (lib/home.ts, ADR-030).
process.env.NEBULOSITY_HOME ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// An import resolves from this file's folder, not the working folder, so tsx comes from the checkout's node_modules.
await import("tsx");

// The data (database, config, demo export) goes to the user's data folder for an installed copy, and stays in the
// checkout's own .nebulosity for a git checkout (ADR-044 amended). The test is this file's own package folder, not
// NEBULOSITY_HOME: mcp/stdio.test.ts points that at a temp folder with no .git. Task 16's bin/nebulosity.mjs repeats
// the same rule: no NEBULOSITY_DATA and no .git -> userDataDir(). It needs tsx first, to import a .ts file.
if (!process.env.NEBULOSITY_DATA && !fs.existsSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), ".git"))){
    const { userDataDir } = await import("../lib/home.ts");
    process.env.NEBULOSITY_DATA = userDataDir();
}
const { main } = await import("./server.ts");
await main();
