import { scanProject } from "@/lib/scan";
import { toFlowGraph } from "@/lib/graph";
import path from "path";

export function GET(){
    const { files, warnings } = scanProject();
    const { nodes, edges } = toFlowGraph(files);

    const degrees = new Map<string, { inDegree: number, outDegree: number }>();

    for (const node of nodes){
        degrees.set(node.id, { inDegree: 0, outDegree: 0 });
    }

    for (const edge of edges){
        const source = degrees.get(edge.source);
        const target = degrees.get(edge.target);

        if (source) source.outDegree++; // checks if source is a real value and not undefined
        if (target) target.inDegree++;
    }

    const mapToArray = Array.from(degrees, ([path, d]) => ({ path, inDegree: d.inDegree, outDegree: d.outDegree}));

    const topFive = mapToArray.sort((a, b) => (b.inDegree + b.outDegree - (a.inDegree + a.outDegree))).slice(0, 5);

    const stats = {
        fileCount: nodes.length,
        edgeCount: edges.length,
        rootName: path.basename(process.cwd()),
        warningCount: warnings.length,
        centralFiles: topFive
    }

    return Response.json({ nodes, edges, stats });
}