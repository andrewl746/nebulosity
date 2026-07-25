import { useState } from "react";

export function useGraphControls(){
    const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());

    const highlight = (ids: string[]) => setHighlightedNodeIds(new Set(ids));
    const clearHighlights = () => setHighlightedNodeIds(new Set());

    return { highlightedNodeIds, highlight, clearHighlights };
}