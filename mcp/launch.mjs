// The command an MCP client runs: `node <checkout or package>/mcp/launch.mjs` (ADR-048, API_CONTRACTS.md §17).
// Plain JavaScript, so node runs it directly: no npx (which needs `cmd /c` on Windows) and no build step.
import { boot } from "../bin/boot.mjs";

// Nebulosity's own files (the migrations, the built Map) live in the checkout or package this file sits in, wherever the
// client starts us: Claude Code starts MCP servers in the user's project folder (lib/home.ts, ADR-030). boot.mjs sets
// NEBULOSITY_HOME to it, loads tsx from it, and keeps an installed copy's data in the user's data folder (ADR-044,
// amended), the same rule bin/nebulosity.mjs follows.
await boot();
const { main } = await import("./server.ts");
await main();
