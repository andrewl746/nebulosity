/**
 * npm run dump-index -- <path-to-repo> --out <file> [--languages <a,b>]
 *
 * Writes what the index stores for one repo as sorted, tab-separated lines, so two runs of different code can be
 * compared section by section (E4's Task F: TypeScript's stored facts must not move). Five sections, each line starting
 * with its section's name:
 * - file   path language isTest lineCount contentHash specifiers-JSON declares-JSON
 * - edge   source target specifier
 * - symbol path qualifiedName kind startLine endLine exported
 * - chunk  path chunkId startLine endLine sha256(text)
 * - entry  path declaredBy
 * It prints each section's line count and sha256. With --languages, only the files whose files.language is one of
 * those, and only the edges whose two ends both are. Read-only: it opens the database read-only (ADR-044).
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getDb, useReadOnlyDatabase, type Db } from "../lib/db/client";
import { requireRepository } from "../lib/db/store/structure";
import { repoKey } from "../lib/index/paths";

export const DUMP_SECTIONS = ["file", "edge", "symbol", "chunk", "entry"] as const;
export type DumpSection = (typeof DUMP_SECTIONS)[number];
export type Dump = Record<DumpSection, string[]>;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const line = (section: DumpSection, fields: readonly (string | number | boolean)[]): string => [section, ...fields.map(String)].join("\t");

type FileRow = { id: number; path: string; language: string; is_test: number; line_count: number; content_hash: string; import_specifiers: string };

/**
 * The repo's index as dump lines, each section sorted in plain code-unit order. Rows are read with raw statements and
 * iterated, so VS Code's chunk texts are hashed one at a time rather than held all at once.
 */
export function dumpIndex(db: Db, repoId: number, options: { languages?: readonly string[] } = {}): Dump {
    const sqlite = db.$client;
    const wanted = options.languages === undefined ? null : new Set(options.languages);
    const kept = new Map<number, string>();   // file id → path, for the files the dump keeps
    const dump: Dump = { file: [], edge: [], symbol: [], chunk: [], entry: [] };

    const fileRows = sqlite.prepare(
        "select id, path, language, is_test, line_count, content_hash, import_specifiers from files where repo_id = ?"
    ).iterate(repoId) as IterableIterator<FileRow>;
    for (const f of fileRows){
        if (wanted !== null && !wanted.has(f.language)) continue;
        kept.set(f.id, f.path);
        const specifiers = JSON.stringify(JSON.parse(f.import_specifiers) as string[]);
        // the files.declares column arrives with migration 0010 (Task F6); until then every file declares nothing
        dump.file.push(line("file", [f.path, f.language, f.is_test === 1, f.line_count, f.content_hash, specifiers, "[]"]));
    }

    const edgeRows = sqlite.prepare(
        "select i.source_file_id as s, i.target_file_id as t, i.specifier as specifier from imports i join files f on f.id = i.source_file_id where f.repo_id = ?"
    ).iterate(repoId) as IterableIterator<{ s: number; t: number; specifier: string }>;
    for (const e of edgeRows){
        const source = kept.get(e.s);
        const target = kept.get(e.t);
        if (source !== undefined && target !== undefined) dump.edge.push(line("edge", [source, target, e.specifier]));
    }

    const symbolRows = sqlite.prepare(
        "select s.file_id as fileId, s.qualified_name as q, s.kind as kind, s.start_line as startLine, s.end_line as endLine, s.exported as exported"
        + " from symbols s join files f on f.id = s.file_id where f.repo_id = ?"
    ).iterate(repoId) as IterableIterator<{ fileId: number; q: string; kind: string; startLine: number; endLine: number; exported: number }>;
    for (const s of symbolRows){
        const filePath = kept.get(s.fileId);
        if (filePath !== undefined) dump.symbol.push(line("symbol", [filePath, s.q, s.kind, s.startLine, s.endLine, s.exported === 1]));
    }

    const chunkRows = sqlite.prepare(
        "select c.file_id as fileId, c.chunk_id as chunkId, c.start_line as startLine, c.end_line as endLine, c.text as text"
        + " from chunks c join files f on f.id = c.file_id where f.repo_id = ?"
    ).iterate(repoId) as IterableIterator<{ fileId: number; chunkId: string; startLine: number; endLine: number; text: string }>;
    for (const c of chunkRows){
        const filePath = kept.get(c.fileId);
        if (filePath !== undefined) dump.chunk.push(line("chunk", [filePath, c.chunkId, c.startLine, c.endLine, sha256(c.text)]));
    }

    const keptPaths = new Set(kept.values());
    const entryRows = sqlite.prepare("select path, declared_by as declaredBy from entry_points where repo_id = ?")
        .iterate(repoId) as IterableIterator<{ path: string; declaredBy: string }>;
    for (const e of entryRows) if (keptPaths.has(e.path)) dump.entry.push(line("entry", [e.path, e.declaredBy]));

    for (const section of DUMP_SECTIONS) dump[section].sort(byCodeUnit);
    return dump;
}

/** Each section's line count and the sha256 of its lines, each ended by "\n" (the section as the dump file holds it). */
export function summarizeDump(dump: Dump): { section: DumpSection; count: number; sha256: string }[] {
    return DUMP_SECTIONS.map((section) => ({
        section,
        count: dump[section].length,
        sha256: sha256(dump[section].map((l) => `${l}\n`).join("")),
    }));
}

function main(): void {
    const args = process.argv.slice(2);
    const target = args[0];
    const outAt = args.indexOf("--out");
    const languagesAt = args.indexOf("--languages");
    const out = outAt === -1 ? undefined : args[outAt + 1];
    const languages = languagesAt === -1 ? undefined : args[languagesAt + 1]?.split(",").map((s) => s.trim()).filter(Boolean);
    if (!target || target.startsWith("--") || !out || (languagesAt !== -1 && (languages === undefined || languages.length === 0))){
        console.error("usage: npm run dump-index -- <path-to-repo> --out <file> [--languages <a,b>]");
        process.exit(1);
    }

    const root = path.resolve(target);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it makes this process open the database read-only (ADR-044)
    useReadOnlyDatabase();
    const db = getDb();
    const dump = dumpIndex(db, requireRepository(db, repoKey(root)), { languages });

    const outFile = path.resolve(out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const stream = fs.openSync(outFile, "w");
    try{
        for (const section of DUMP_SECTIONS) fs.writeSync(stream, dump[section].map((l) => `${l}\n`).join(""));
    } finally{
        fs.closeSync(stream);
    }

    console.log(`[dump] ${repoKey(root)}${languages ? ` (languages ${languages.join(",")})` : ""} → ${outFile}`);
    for (const s of summarizeDump(dump)) console.log(`[dump] ${s.section}\t${s.count}\t${s.sha256}`);
}

if (/[\\/]dump-index\.ts$/.test(process.argv[1] ?? "")) main();
