import StarField from "./components/StarField";
import TerminalPanel from "./components/TerminalPanel";
import GraphView from "./components/GraphView"

export default function Home() {
  // Server component: a lightweight shell. 
  // The graph is fetched client-side by GraphView from /api/graph; 
  // this component just lays out the static chrome

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

      <GraphView />

      {/* Console layer, flush against the left edge */}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex pt-9">
        <TerminalPanel />
      </div>
    </div>
  );
}
