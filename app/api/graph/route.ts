import { scanProject, readTsconfigAliases } from "@/lib/scan";
import { resolveEdges, toFlowGraph, classifyFile } from "@/lib/graph";
import { saveScan, loadGraph, getCentralFiles } from "@/lib/db/graph-store";
import path from "path";

export function GET(){
    const rootPath = process.cwd();
    const { files, warnings } = scanProject();
    const aliases = readTsconfigAliases();
    const resEdges = resolveEdges(files, "", aliases);

    const scanFileInputs = files.map((f) => ({
        path: f.id,
        kind: classifyFile(f.id)
    }));

    saveScan(rootPath, scanFileInputs, resEdges);

    const loaded = loadGraph(rootPath)!;

    const nodeInputFiles = loaded.files.map((f) => ({ id: f.path, imports: [] as string[]}));

    const { nodes, edges } = toFlowGraph(nodeInputFiles, loaded.edges);
    const centralFiles = getCentralFiles(rootPath);

    const stats = {
        fileCount: nodeInputFiles.length,
        edgeCount: edges.length,
        rootName: path.basename(process.cwd()),
        warningCount: warnings.length,
        centralFiles
    }

    return Response.json({ nodes, edges, stats });
}
