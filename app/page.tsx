import path from "path";
import GraphCanvas from "./components/GraphCanvas";
import StarField from "./components/StarField";
import TerminalPanel from "./components/TerminalPanel";
import { toFlowGraph } from "@/lib/graph";
import { scanProject } from "@/lib/scan";

export default function Home() {
  // Server component: scan the codebase on the server at render time and
  // hand the finished graph to the client canvas as plain props.
  const files = scanProject();
  const { nodes, edges } = toFlowGraph(files);
  const rootName = path.basename(process.cwd());

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#06070B]">
      {/* Distant nebula: subtle radial glow behind the grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_60%_40%,rgba(126,58,242,0.14),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_35%_30%_at_75%_65%,rgba(88,28,135,0.10),transparent_70%)]"
      />

      {/* Starlight dust between the nebula glow and the grid */}
      <StarField />

      {/* Main viewport: React Flow canvas fills the screen under the panels */}
      <main className="absolute inset-0">
        <GraphCanvas nodes={nodes} edges={edges} />
      </main>

      {/* Observed-sector status bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-9 items-center justify-center border-b border-purple-500/15 bg-[#06070B]/40 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-cyan-300/80" />
          <span className="font-mono text-[10px] font-extralight uppercase tracking-[0.3em] text-zinc-400">
            observing <span className="text-zinc-200">~/{rootName}</span>
          </span>
          <span className="font-mono text-[10px] font-extralight text-zinc-600">
            {nodes.length} Files · {edges.length} Links
          </span>
        </div>
      </div>

      {/* Console layer, flush against the left edge */}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex pt-9">
        <TerminalPanel />
      </div>
    </div>
  );
}
