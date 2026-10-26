import type { ChunkKind } from "../../lib/contracts";
import type { SymbolRow } from "../../lib/db/schema";
import type { ReferenceKind } from "../../lib/index/languages/adapter";

export type TruthEdge = { source: string; target: string };

/** A language fixture's ground truth, written by hand from its files before the adapter's code (CLAUDE.md). */
export type FixtureTruth = {
    /** Every file of the adapter's language in the fixture that a full run indexes, sorted by path. */
    files: { path: string; language: string; isTest: boolean; lineCount: number }[];
    /** Files of the language that discovery must leave out (an excluded folder's), sorted. */
    excluded: string[];
    /** Each indexed file's specifiers from the full reading, in source order. */
    specifiers: Record<string, string[]>;
    /** Each indexed file's declares, sorted. */
    declares: Record<string, string[]>;
    /** Each indexed file's symbols, in source order. */
    symbols: Record<string, SymbolRow[]>;
    /** What kindOf returns for each specifier of each file. */
    kinds: Record<string, Record<string, ReferenceKind>>;
    /** Every import edge between the fixture's files after a full run, sorted by source, then target. */
    edges: TruthEdge[];
    /** Entry points, sorted by path. */
    entryPoints: { path: string; declaredBy: string }[];
    /** The fixture's file with a syntax error, and the specifiers still read from it. */
    broken: { path: string; specifiers: string[] };
    /** Where the scan reading differs from the full reading's imports, per file (deliberate differences only). */
    scan?: Record<string, string[]>;
    /** Chunks of the listed files, in order. Their text is checked against those lines. */
    chunks: Record<string, { kind: ChunkKind; name: string; startLine: number; endLine: number }[]>;
    /**
     * Edits applied one at a time to a fresh, indexed copy, each with every edge afterwards (sorted). Name-based languages
     * include one that changes a file's declares; every language includes one that changes the file set and one that
     * changes a manifest. A null write deletes the file.
     */
    edits: { description: string; writes: Record<string, string | null>; edgesAfter: TruthEdge[] }[];
};
