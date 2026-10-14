import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

const BATCH_SIZE = 16;

// lazy loaded embedding pipeline (model loads on first call, not at module import time).
// The cache holds the loading PROMISE, not the finished pipeline: the pipeline only exists after an await, so two calls
// that start together (Claude Code sends tool calls in parallel) would each see an empty cache and each load the model.
let pipelineLoading: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
    pipelineLoading ??= loadPipeline().catch((err) => {
        pipelineLoading = null;   // a failed load isn't kept, so the next call tries again
        throw err;
    });

    return pipelineLoading;
}

async function loadPipeline(): Promise<FeatureExtractionPipeline> {
    // dynamic import so the module can be imported without loading the model
    const { pipeline } = await import("@huggingface/transformers");

    // the model is ~25 MB and is fetched from huggingface.co the first time
    // it is used, then cached under node_modules/.cache. Without this line a
    // cold first index looks like a hang.
    // stderr, not stdout: V1.4's MCP server speaks JSON-RPC over stdout, and one stray line there breaks the protocol.
    console.error(`[embed] loading ${EMBEDDING_MODEL} (first run downloads ~25 MB)…`);

    return pipeline("feature-extraction", EMBEDDING_MODEL);
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
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE){
        const batch = texts.slice(i, i + BATCH_SIZE);

        // Transformers.js returns ONE Tensor for the whole batch, not one per
        // text: a flat, row-major Float32Array plus a `dims` shape of
        // [rows, EMBEDDING_DIM]. Nothing in the object separates the rows — we
        // cut them apart ourselves using dims. (Reading `.data` as if it were a
        // single vector is what made every batch collapse into one 6144-float
        // "vector"; see RAG_IMPLEMENTATION_REVIEW.md R2.)
        const output = await pipe(batch, { pooling: "mean", normalize: true });
        const [rows, dim] = output.dims;

        if (rows !== batch.length || dim !== EMBEDDING_DIM){
            throw new Error(
                `Unexpected embedding shape [${output.dims.join(", ")}] for a batch of ` +
                `${batch.length}; expected [${batch.length}, ${EMBEDDING_DIM}]`
            );
        }

        const data = output.data as Float32Array;

        for (let row = 0; row < rows; row++){
            // .slice() COPIES. .subarray() would return a view that keeps every
            // vector pointing into the shared batch buffer, which then has to be
            // accounted for at every serialization site downstream. Owning the
            // memory here makes each vector independently storable.
            results.push(data.slice(row * dim, (row + 1) * dim));
        }

        if (onProgress){
            onProgress(Math.min(i + BATCH_SIZE, texts.length), texts.length);
        }
    }

    return results;
}

/**
 * Vectors are persisted as raw host-order float32 bytes in a BLOB column.
 *
 * encode/decode are exact inverses and live together deliberately: both of the
 * bugs they replace (RAG_IMPLEMENTATION_REVIEW.md R3 and R4) came from doing
 * this conversion inline at the call site, in two different files, wrong in two
 * different ways.
 */
export function encodeVector(vector: Float32Array): Buffer {
    // `vector.buffer` is the WHOLE backing ArrayBuffer, which may be much larger
    // than this particular view. The offset/length arguments are what keep us to
    // our own window instead of serializing the entire batch.
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function decodeVector(buf: Buffer): Float32Array {
    const bytesPerFloat = Float32Array.BYTES_PER_ELEMENT;

    if (buf.byteLength % bytesPerFloat !== 0){
        throw new Error(
            `Vector blob of ${buf.byteLength} bytes is not a whole number of float32s`
        );
    }

    // Allocate first, then copy the bytes in. Constructing a Float32Array as a
    // *view* over the Buffer would be faster but is unsafe twice over: the third
    // constructor argument counts elements, not bytes, and Node serves small
    // Buffers from a shared pool whose byteOffset is often not 4-byte aligned —
    // which that constructor rejects. `new Float32Array(n)` always owns an
    // aligned buffer starting at offset 0.
    const vector = new Float32Array(buf.byteLength / bytesPerFloat);
    new Uint8Array(vector.buffer).set(buf);

    return vector;
}

// validates that a vector has length 384 and is normalized (unit vector of magnitude 1)
// used in testing
export function validateVector(vector: Float32Array): { valid: boolean; magnitude: number } {
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
        valid: length === EMBEDDING_DIM && Math.abs(magnitude - 1) < 0.001, // makes sure it's a unit vector
        magnitude: magnitude
    };
}

// used in testing
export function getEmbeddingModelInfo() {
    return {
        name: EMBEDDING_MODEL,
        dimension: EMBEDDING_DIM,
    };
}