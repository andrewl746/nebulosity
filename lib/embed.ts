import type { CodeChunk } from "@/lib/contracts";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

// lazy loaded embedding pipeline (model loads on first call, not at module import time)
let pipelineInstance: FeatureExtractionPipeline | null = null;

async function getPipeline(){
    if (!pipelineInstance){
        // dynamic import so the module can be imported without loading the model
        const { pipeline } = await import("@huggingface/transformers");

        pipelineInstance = await pipeline(
            "feature-extraction",
            "Xenova/all-MiniLM-L6-v2"
        );
    }

    return pipelineInstance;
}

/**
 * builds the text that actually gets embedded
 * we embed a constructed text (acting like an enriched summary page), not the raw chunk source
 * 
 * why? the model has a ~256 token limit
 * we front-load the most identifying information (path, kind/name, doc comment, signature)
 */
function buildEmbeddingText(chunk: CodeChunk): string {
    const parts: string[] = [];
    
    // 1. file path (tells the model where this code lives)
    parts.push(`File: ${chunk.filePath}`);
    
    // 2. kind and name (the most important signal)
    parts.push(`${chunk.kind}: ${chunk.name}`);
    
    // 3. doc comment (extracts JSDoc/comment above the declaration)
    const docComment = extractDocComment(chunk.text);
    if (docComment){
        parts.push(`Description: ${docComment}`);
    }
    
    // 4. signature (first line usually contains the function/class signature)
    const firstLine = chunk.text.split("\n")[0];
    if (firstLine){
        parts.push(`Signature: ${firstLine}`);
    }
    
    // 5. body (up to ~200 lines, truncated to fit token budget)
    const bodyLines = chunk.text.split("\n");
    const bodyStart = bodyLines.length > 1 ? 1 : 0; // skip the first line if it was the signature
    const body = bodyLines.slice(bodyStart, 201).join("\n");

    if (body){
        parts.push(body);
    }
    
    return parts.join("\n");
}

/**
 * extracts the leading doc comment from code text
 * handles both /** and // styles
 */
function extractDocComment(text: string): string | null {
    const lines = text.split("\n");
    const commentLines: string[] = [];
    let inComment = false;
    
    for (const line of lines){
        const trimmed = line.trim();
        
        // JSDoc style: /**
        if (trimmed.startsWith("/**")){
            inComment = true;
            const content = trimmed.replace(/^\/\*\*?\s*/, "").replace(/\*\/$/, "");

            if (content){
                commentLines.push(content);
            }

            continue;
        }
        
        // JSDoc continuation: *
        if (inComment && trimmed.startsWith("*")){
            const content = trimmed.replace(/^\*\s?/, "");

            if (content && !content.startsWith("/")){
                commentLines.push(content);
            }

            continue;
        }
        
        // end of JSDoc
        if (inComment && trimmed.endsWith("*/")){
            inComment = false;
            continue;
        }
        
        // single-line comment: //
        if (trimmed.startsWith("//")){
            const content = trimmed.replace(/^\/\/\s?/, "");
            if (content){
                // Check if this is a "description" comment (not just a TODO or warning)
                if (!content.match(/^(TODO|FIXME|HACK|NOTE|WARNING|DEPRECATED|eslint|prettier|@ts-)/i)){
                    commentLines.push(content);
                }
            }

            // continue checking subsequent lines (multi-line // comments)
            continue;
        }
        
        // stop collecting if we hit code (unless we're in a JSDoc block)
        if (!inComment && trimmed && !trimmed.startsWith("//")){
            break;
        }
    }
    
    return commentLines.length > 0 ? commentLines.join(" ") : null;
}

/**
 * main embedding function
 * turns the enriched text into numbers (embeds multiple texts in batches) 
 * returns normalized Float32Array vectors
 */
export async function embedTexts(
    texts: string[],
    onProgress?: (done: number, total: number) => void
): Promise<Float32Array[]> {
    if (texts.length === 0){
        return [];
    }

    const pipe = await getPipeline();
    const batchSize = 16;
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += batchSize){
        const batch = texts.slice(i, i + batchSize);

        // uses the model to turn the embedded text into vector arrays
        const output = await pipe(batch, {
            pooling: "mean",
            normalize: true,
        });

        // Transformers.js returns either:
        // - a single Float32Array (if input was a string)
        // - an array of Float32Array (if input was an array of strings)
        if (Array.isArray(output)){
            for (const item of output){
                if (item instanceof Float32Array){
                    results.push(item);
                } else if (Array.isArray(item)) {
                    results.push(new Float32Array(item));
                } else if (item && typeof item === 'object'){
                    // try to extract data from tensor object
                    const tensor = item as { data?: Float32Array | number[] };
                    if (tensor.data instanceof Float32Array){
                        results.push(tensor.data);
                    } else if (Array.isArray(tensor.data)){
                        results.push(new Float32Array(tensor.data));
                    } else{
                        throw new Error(`Unexpected item type: ${typeof item}`);
                    }
                } else{
                    throw new Error(`Unexpected item type: ${typeof item}`);
                }
            }
        } else if (output instanceof Float32Array){
            results.push(output);
        } else if (output && typeof output === 'object'){
            // single input, tensor object
            const tensor = output as { data?: Float32Array | number[] };
            if (tensor.data instanceof Float32Array){
                results.push(tensor.data);
            } else if (Array.isArray(tensor.data)){
                results.push(new Float32Array(tensor.data));
            } else{
                throw new Error(`Unexpected output format: ${typeof output}`);
            }
        } else{
            throw new Error(`Unexpected output format: ${typeof output}`);
        }

        if (onProgress){
            const done = Math.min(i + batchSize, texts.length);
            onProgress(done, texts.length);
        }
    }

    return results;
}

// embed an array of code chunks
export async function embedChunks(
    chunks: CodeChunk[]
): Promise<Array<{ chunk: CodeChunk; vector: Float32Array }>> {
    if (chunks.length === 0){
        return [];
    }
    
    // build the embedding texts
    const embeddingTexts = chunks.map(chunk => buildEmbeddingText(chunk));
    
    // get embeddings
    const vectors = await embedTexts(embeddingTexts);
    
    // pair them back up
    return chunks.map((chunk, i) => ({
        chunk,
        vector: vectors[i]
    }));
}

// validates that a vector has length 384 and is normalized (unit vector of magnitude 1)
// used in tests only
export function validateVector(vector: Float32Array): { valid: boolean; length: number } {
    const length = vector.length;

    // pythagoran theorem (a^2 + b^2 + c^2 + ... so on till the square of all 384 numbers are summed,
    // then square root it to find magnitude)
    // literally the magnitude formula from the ib vector unit
    let sum = 0;
    for (let i = 0; i < length; i++){
        sum += vector[i] * vector[i];
    }

    const magnitude = Math.sqrt(sum);

    return {
        valid: length === 384 && Math.abs(magnitude - 1) < 0.001, // makes sure it's a unit vector
        length: magnitude
    };
}

