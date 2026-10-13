// The command an MCP client runs: `node <checkout>/mcp/launch.mjs` (ADR-048, API_CONTRACTS.md §17).
// Plain JavaScript, so node runs it directly: no npx (which needs `cmd /c` on Windows) and no build step.
import path from "node:path";
import { fileURLToPath } from "node:url";

// Nebulosity's own files (the database, the migrations, the config) live in the checkout this file sits in, wherever
// the client starts us: Claude Code starts MCP servers in the user's project folder (lib/home.ts, ADR-030).
process.env.NEBULOSITY_HOME ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// An import resolves from this file's folder, not the working folder, so tsx comes from the checkout's node_modules.
await import("tsx");
const { main } = await import("./server.ts");
await main();
