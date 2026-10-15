/**
 * The eval's second extractor (R2 of V1.6's plan): TypeScript's own preProcessFile reads each file's import, export … from,
 * import x = require, import() and require() specifiers with TypeScript's scanner, so a comment or a string never counts
 * and a statement split over lines still does. The regex scanner (scan.ts) reads the same files another way; both resolve
 * through the same resolver, and every edge one finds and the other doesn't is read in the source. It imports nothing
 * from lib/.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { resolveSpecifier, type ResolveBare, type ScannedGraph } from "./scan";

/** The specifiers TypeScript's preProcessFile finds in a file's text, in source order, each with the line it sits on. */
export function preProcessImports(text: string): { specifier: string; line: number }[] {
    const starts = [0];
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    // the 1-based line holding a position: the last line start at or before it, found by halving
    const lineAt = (pos: number): number => {
        let [low, high] = [0, starts.length - 1];
        while (low < high){
            const mid = Math.ceil((low + high) / 2);
            if (starts[mid] <= pos) low = mid;
            else high = mid - 1;
        }
        return low + 1;
    };
    return ts.preProcessFile(text, true, true).importedFiles
        .map((f) => ({ specifier: f.fileName, pos: f.pos }))
        .sort((a, b) => a.pos - b.pos)
        .map(({ specifier, pos }) => ({ specifier, line: lineAt(pos) }));
}

/** The import graph of `files` as preProcessFile reads it, resolved like scanRepo's: relative paths, then `resolve`. Each pair once. */
export function preProcessGraph(root: string, files: readonly string[], resolve: ResolveBare): ScannedGraph {
    const known = new Set(files);
    const edges: [string, string][] = [];
    for (const file of files){
        const seen = new Set<string>();
        for (const { specifier } of preProcessImports(fs.readFileSync(path.join(root, file), "utf8"))){
            const target = resolveSpecifier(file, specifier, known, resolve);
            if (target !== null && target !== file && !seen.has(target)){
                seen.add(target);
                edges.push([file, target]);
            }
        }
    }
    return { files: [...files], edges };
}
