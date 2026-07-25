"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type FileKind = "component" | "module";

export type FileNodeType = Node<
  {
    fileName: string;
    dir: string;
    kind: FileKind;
    highlighted?: boolean;
    dimmed?: boolean;
  },
  "file"
>;

const DOT_STYLES: Record<FileKind, string> = {
  // Page / server / React component files — cyan
  component: "bg-cyan-300",
  // Utility scripts / config libraries — clean amethyst
  module: "bg-purple-400",
};

/**
 * Terminal-chip file node: transparent black glass, thin glowing border,
 * filename in starlight gray with its directory dimmed underneath.
 */
function FileNode({ data }: NodeProps<FileNodeType>) {
  return (
    <div
      title={data.dir ? `${data.dir}/${data.fileName}` : data.fileName}
      className={`max-w-56 rounded-sm border bg-black/60 px-3 py-1.5 font-mono shadow-sm backdrop-blur-md transition ${
        data.highlighted
          ? "border-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.45)]" // bright glow border
          : "border-purple-400/20" // normal border
      } ${data.dimmed ? "opacity-50" : ""}`} // dimmed node
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLES[data.kind]}`}
        />
        <span className="truncate text-[12px] font-light tracking-wide text-zinc-200">
          {data.fileName}
        </span>
      </div>
      {data.dir && (
        <div className="mt-0.5 truncate pl-3.5 text-[9px] font-light tracking-wider text-zinc-500">
          {data.dir}/
        </div>
      )}

      <Handle
        type="target"
        position={Position.Top}
        className="!h-1 !w-1 !border-0 !bg-purple-400/50"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1 !w-1 !border-0 !bg-purple-400/50"
      />
    </div>
  );
}

// memo: React Flow re-renders nodes on every pan/zoom otherwise.
export default memo(FileNode);
