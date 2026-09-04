import { getDb } from "./db/client";
import { eq } from "drizzle-orm";
import { repositories, files, chunks, vectors } from "./db/schema";
import { embedTexts, decodeVector } from "./embed";
import type { RetrievedChunk, CodeChunk } from "./contracts";

// --------------------------------------------------------------------------------------
// Caching (loading vectors once from db and never again unless the repo gets reindexed)
// --------------------------------------------------------------------------------------

interface VectorCache {
  lastIndexAtMs: number | null; // stores primitive number, not Date object
  vectors: Map<string, Float32Array>; // chunkId (string) -> embedding
  chunks: Map<string, Omit<CodeChunk, "id">>; // chunkId (string) -> chunk data
}

let cache: VectorCache | null = null;

export async function getVectorCache(): Promise<VectorCache> {
    const db = getDb();

    const repo = await db
        .select({ lastIndexAt: repositories.lastIndexAt })
        .from(repositories)
        .limit(1)
        .then((rows) => rows[0] || null);
    
    const lastIndexAtMs = repo?.lastIndexAt?.getTime() ?? null;

    // checks if vectors need to be recached
    if (cache && cache.lastIndexAtMs === lastIndexAtMs){
        return cache;
    }

    // build fresh cache
    const newCache: VectorCache = {
        lastIndexAtMs,
        vectors: new Map(),
        chunks: new Map()
    }

    if (lastIndexAtMs !== null){
        // get the single repo ID
        const repoIdResult = await db
            .select({ id: repositories.id })
            .from(repositories)
            .limit(1)
            .then((rows) => rows[0]);

        if (repoIdResult){
            // join tables to load all vectors + chunk metadata
            const rows = await db
                .select({
                    chunkId: chunks.chunkId,
                    filePath: files.path,
                    kind: chunks.kind,
                    name: chunks.name,
                    startLine: chunks.startLine,
                    endLine: chunks.endLine,
                    exported: chunks.exported,
                    partIndex: chunks.partIndex,
                    text: chunks.text,
                    fileHash: chunks.fileHash,
                    embedding: vectors.embedding,
                })
                .from(vectors)
                .innerJoin(chunks, eq(vectors.chunkId, chunks.id))
                .innerJoin(files, eq(chunks.fileId, files.id))
                .where(eq(files.repoId, repoIdResult.id));

            for (const row of rows){
                // convert BLOB (Buffer) back to Float32Array
                newCache.vectors.set(row.chunkId, decodeVector(row.embedding as Buffer));

                // get chunk data
                const chunkData: Omit<CodeChunk, "id"> = {
                    filePath: row.filePath,
                    kind: row.kind,
                    name: row.name,
                    startLine: row.startLine,
                    endLine: row.endLine,
                    exported: row.exported,
                    partIndex: row.partIndex,
                    text: row.text,
                    fileHash: row.fileHash
                };

                newCache.chunks.set(row.chunkId, chunkData);
            }
        }
    }

    cache = newCache;
    return cache;
}

// ------------------------------------------------------------------
// Retrieval Logic
// ------------------------------------------------------------------

export async function retrieve(
    query: string,
    k: number = 8,
    threshold: number = 0.25
): Promise<RetrievedChunk[]> {
    const cache = await getVectorCache();

    if (cache.vectors.size === 0){
        return [];
    }

    // 1. embed the query
    const [queryVector] = await embedTexts([query]);

    // 2. compute cosine similarity for (brute force all dot products of chunk embeddings with the query embedding)
    const scored: { chunkId: string; score: number }[] = [];

    for (const [chunkId, vec] of cache.vectors){
        let dot = 0;
        for (let i = 0; i < vec.length; i++){
            dot += queryVector[i] * vec[i];
        }

        if (dot >= threshold){
            scored.push({ chunkId, score: dot });
        }
    }

    // 3. sort scored in descending order and take the top k chunk ids
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);

    // 4. map chunk ids back to their full chunks
    const results: RetrievedChunk[] = [];
    for (const { chunkId, score } of top){
        const chunkData = cache.chunks.get(chunkId);
        
        if (!chunkData){
            continue;
        }

        results.push({
            id: chunkId,
            ...chunkData,
            score
        });
    }

    return results;
}
