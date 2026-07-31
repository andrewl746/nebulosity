import type { Edge } from "@xyflow/react";
import type { FileKind, FileNodeType } from "@/app/components/FileNode";

/** One entry per scanned source file, produced by scanProject (lib/scan.ts). */
export type ScannedFile = {
  /** File path (absolute or project-relative, either slash style). */
  id: string;
  /** Raw import specifiers, e.g. "./utils", "@/lib/graph", "react". */
  imports: string[];
};

/** Extensions the scanner picks up, in the order Node/Next would resolve them. */
const EXTENSION_CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
];

const JS_TO_TS_REWRITE: Record<string, string> = {
  ".js": ".ts",
  ".jsx": ".tsx",
  ".mjs": ".mts",
  ".cjs": ".cts"
}

/** Distance between concentric rings, in React Flow canvas units (px at zoom 1). */
const RING_GAP = 240;
/** How many nodes fit on the innermost ring; outer rings scale with circumference. */
const FIRST_RING_CAPACITY = 6;

/** Windows backslashes → forward slashes so ids compare consistently. */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Pure-string path join + ".." collapsing, so this module stays free of
 * node:path and can be imported from client components too.
 */
export function resolveSegments(baseDir: string, relative: string): string {
  const segments = normalizeSlashes(baseDir).split("/");
  for (const part of normalizeSlashes(relative).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

// Turns a raw import path into a project-relative file id, or null if the import is external (npm package).
export function resolveImport (importerId: string, specifier: string, aliases: Record<string, string> = {}){
  if (specifier.startsWith("./") || specifier.startsWith("../")){
    const importerDir = importerId.split("/").slice(0, -1).join("/");
    return resolveSegments(importerDir, specifier);
  }

  for (const [prefix, replacement] of Object.entries(aliases)){
    if (specifier.startsWith(prefix)){
      return replacement + specifier.slice(prefix.length);
    }
  }

  return null;
}

/**
 * Deterministic radial layout: node 0 sits at the origin, the rest fill
 * concentric rings whose capacity grows with radius. No overlaps, no
 * dependencies — good enough until you swap in a force/dagre layout.
 */
export function radialPosition(index: number, total: number): { x: number; y: number } {
  if (index === 0) return { x: 0, y: 0 };

  let ring = 1;
  let ringStart = 1; // index of the first node on the current ring
  while (index >= ringStart + FIRST_RING_CAPACITY * ring) {
    ringStart += FIRST_RING_CAPACITY * ring;
    ring += 1;
  }

  const capacity = Math.min(FIRST_RING_CAPACITY * ring, total - ringStart);
  const slot = index - ringStart;
  // Offset alternate rings by half a slot so spokes don't line up visually.
  const angle = (slot / capacity) * 2 * Math.PI + (ring % 2) * (Math.PI / capacity);
  const radius = ring * RING_GAP;

  // `|| 0` normalizes -0 to 0: Math.PI is only an approximation of π, so
  // angles that should land exactly on an axis (e.g. 3π/2) leave a tiny
  // floating-point residual: cos()/sin() return a value extremely close to
  // but not exactly 0, and Math.round() of a small negative residual
  // produces -0. Meaningless for a canvas position, but breaks exact
  // equality checks (Object.is/toEqual distinguish -0 from 0) if left in.
  return {
    x: Math.round(Math.cos(angle) * radius) || 0,
    y: Math.round(Math.sin(angle) * radius) || 0,
  };
}

/**
 * Rough semantic classification for the node's indicator dot:
 * .tsx/.jsx files render UI (pages, layouts, components) → "component";
 * plain .ts/.js files are utilities, scripts, or config → "module".
 */
export function classifyFile(id: string): FileKind {
  return id.endsWith(".tsx") || id.endsWith(".jsx") ? "component" : "module";
}

export type CodebaseGraph = { nodes: FileNodeType[]; edges: Edge[] };

/**
 * Transform the scanner's raw output into React Flow's Node[] / Edge[].
 *
 * @param files   Output of scanProject (lib/scan.ts).
 * @param rootDir Project root to strip from absolute ids (e.g. process.cwd()).
 *                Pass "" if ids are already project-relative.
 */

export type ResolvedEdge = { source: string, target: string, specifier: string };

export function resolveEdges(files: ScannedFile[], rootDir = "", aliases: Record<string, string> = {}): ResolvedEdge[] {
  const root = normalizeSlashes(rootDir).replace(/\/+$/, "");

  const toRelativeId = (rawPath: string): string => {
    const p = normalizeSlashes(rawPath);
    return root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
  };

  const fileIds: Set<string> = new Set(files.map((f) => toRelativeId(f.id)));
  const edges: ResolvedEdge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const sourceId = toRelativeId(file.id);
    for (const specifier of file.imports) {
      const base = resolveImport(sourceId, specifier, aliases);
      if (base === null) continue; // external package, no node to link to
      
      const baseCandidates = [base];
      for (const [js, ts] of Object.entries(JS_TO_TS_REWRITE)){
        if (base.endsWith(js)){
          baseCandidates.push(base.slice(0, -js.length) + ts);
        }
      }

      let targetId = "";
      for (const candidate of baseCandidates) {
        const ext = EXTENSION_CANDIDATES.find((e) => fileIds.has(candidate + e));
        if (ext !== undefined){
          targetId = candidate + ext;
          break;
        }
      }

      if (targetId === "" || targetId === sourceId) continue;

      const edgeId = `${sourceId}->${targetId}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);

      edges.push({ source: sourceId, target: targetId, specifier });
    }
  }

  return edges;
}

export function toFlowGraph(files: ScannedFile[], edges: ResolvedEdge[], rootDir = ""): CodebaseGraph {
  const root = normalizeSlashes(rootDir).replace(/\/+$/, "");

  const toRelativeId = (rawPath: string): string => {
    const p = normalizeSlashes(rawPath);
    return root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
  };

  const nodes: FileNodeType[] = files.map((file, index) => {
    const id = toRelativeId(file.id);
    const segments = id.split("/");
    return {
      id,
      type: "file",
      position: radialPosition(index, files.length),
      data: {
        fileName: segments[segments.length - 1],
        dir: segments.slice(0, -1).join("/"),
        kind: classifyFile(id),
      },
    };
  });

  const flowEdges: Edge[] = edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    style: { stroke: "rgba(168, 85, 247, 0.5)", strokeWidth: 1 }
  }));

  return { nodes, edges: flowEdges };
}
