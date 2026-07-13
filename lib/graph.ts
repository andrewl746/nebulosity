import type { Edge } from "@xyflow/react";
import type { FileKind, FileNodeType } from "@/app/components/FileNode";

/** Shape emitted by scripts/scan.ts — one entry per scanned source file. */
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
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
];

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
function resolveSegments(baseDir: string, relative: string): string {
  const segments = normalizeSlashes(baseDir).split("/");
  for (const part of normalizeSlashes(relative).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/**
 * Deterministic radial layout: node 0 sits at the origin, the rest fill
 * concentric rings whose capacity grows with radius. No overlaps, no
 * dependencies — good enough until you swap in a force/dagre layout.
 */
function radialPosition(index: number, total: number): { x: number; y: number } {
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

  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

/**
 * Rough semantic classification for the node's indicator dot:
 * .tsx/.jsx files render UI (pages, layouts, components) → "component";
 * plain .ts/.js files are utilities, scripts, or config → "module".
 */
function classifyFile(id: string): FileKind {
  return id.endsWith(".tsx") || id.endsWith(".jsx") ? "component" : "module";
}

export type CodebaseGraph = { nodes: FileNodeType[]; edges: Edge[] };

/**
 * Transform the scanner's raw output into React Flow's Node[] / Edge[].
 *
 * @param files   Output of scripts/scan.ts.
 * @param rootDir Project root to strip from absolute ids (e.g. process.cwd()).
 *                Pass "" if ids are already project-relative.
 */
export function toFlowGraph(files: ScannedFile[], rootDir = ""): CodebaseGraph {
  const root = normalizeSlashes(rootDir).replace(/\/+$/, "");

  const toRelativeId = (rawPath: string): string => {
    const p = normalizeSlashes(rawPath);
    return root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
  };

  // Index every scanned file by id so import specifiers can be resolved
  // against real files instead of guessed.
  const fileIds = new Set(files.map((f) => toRelativeId(f.id)));

  const resolveImport = (importerId: string, specifier: string): string | null => {
    let base: string;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const importerDir = importerId.split("/").slice(0, -1).join("/");
      base = resolveSegments(importerDir, specifier);
    } else if (specifier.startsWith("@/")) {
      // tsconfig alias: "@/*" -> "<root>/*"
      base = specifier.slice(2);
    } else {
      // Bare specifier ("react", "next/image") — an npm package, not a
      // local file. No node exists for it, so no edge.
      return null;
    }

    for (const ext of EXTENSION_CANDIDATES) {
      if (fileIds.has(base + ext)) return base + ext;
    }
    return null;
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

  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const sourceId = toRelativeId(file.id);
    for (const specifier of file.imports) {
      const targetId = resolveImport(sourceId, specifier);
      if (!targetId || targetId === sourceId) continue;

      const edgeId = `${sourceId}->${targetId}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);

      edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        animated: true,
        style: { stroke: "rgba(168, 85, 247, 0.45)", strokeWidth: 1 },
      });
    }
  }

  return { nodes, edges };
}
