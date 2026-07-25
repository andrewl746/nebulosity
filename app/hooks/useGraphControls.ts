import { useState } from "react";
import { useReactFlow } from "@xyflow/react";

export function useGraphControls(){
    const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());

    const highlight = (ids: string[]) => setHighlightedNodeIds(new Set(ids));
    const clearHighlights = () => setHighlightedNodeIds(new Set());

    const { fitView } = useReactFlow();
    const focusNode = (id: string) => fitView({ nodes: [{ id }], duration: 600});

    return { highlightedNodeIds, highlight, clearHighlights, focusNode };
}