/**
 * The adapter conformance kit (Task F of the E4 plan): every language adapter is held to the same checks K1–K13 against
 * its fixture's hand-derived truth (fixture-truth.ts). A language task calls describeAdapterConformance once, from its
 * own conformance.test.ts; nothing here knows any language.
 *
 * The fixture is copied before it is indexed, so its files are read as this checkout has them: with CRLF line endings
 * on a Windows checkout with core.autocrlf (K13 holds the products to be the same either way).
 */
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../../lib/db/client";
import { chunks, entryPoints, files, symbols } from "../../lib/db/schema";
import { loadImportEdges, loadStoredFiles } from "../../lib/db/store/structure";
import { listManifests } from "../../lib/index/discover";
import type { LanguageAdapter, ParsedFile, Reading } from "../../lib/index/languages/adapter";
import { adapterFor, prepareLanguages } from "../../lib/index/languages/registry";
import { createResolvers } from "../../lib/index/languages/resolution";
import { withoutBom } from "../../lib/index/languages/treesitter";
import { typescriptAdapter } from "../../lib/index/languages/typescript-adapter";
import { indexRepository, repoTextReader } from "../../lib/index/pipeline";
import { applyFileChanges } from "../../lib/index/update";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";
import { makeTempDir } from "./temp";

const READINGS: Reading[] = ["full", "parse", "scan"];
const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byEdge = (a: TruthEdge, b: TruthEdge): number =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
const BOM = String.fromCharCode(0xfeff);

/**
 * K13's three texts of a file as read: LF, its CRLF twin, and U+FEFF + LF. The file's own byte-order mark is dropped
 * first, so a file saved with one (Visual Studio writes it on C# files) gets exactly one in the BOM copy, not two
 * (Task I; progress-csharp.md: two made the products differ, since parsing drops only one).
 */
export function k13Texts(onDisk: string): { lf: string; crlf: string; bom: string } {
    const lf = withoutBom(onDisk).replace(/\r\n/g, "\n");
    return { lf, crlf: lf.replace(/\n/g, "\r\n"), bom: `${BOM}${lf}` };
}

/** A file's lines as chunk text holds them: each without its ending ("\r\n" or "\n"). */
function linesOf(text: string): string[] {
    return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

export function describeAdapterConformance(adapter: LanguageAdapter, fixture: { name: string; truth: FixtureTruth }): void {
    const { truth } = fixture;
    const source = path.resolve("test", "fixtures", fixture.name);
    const adapters = [typescriptAdapter, adapter];
    const paths = truth.files.map((f) => f.path);
    const read = (rel: string): string => fs.readFileSync(path.join(source, rel), "utf8");
    const parse = (rel: string, reading: Reading = "full", text: string = read(rel)): ParsedFile => adapter.parse(rel, text, reading);

    /** A private copy of the fixture, indexed by a full run with the two adapters. */
    function indexedCopy(options: { maxFileBytes?: number; parseMaxFileBytes?: number } = {}): { root: string; repoId: number } {
        const root = makeTempDir(`neb-conformance-${adapter.id}-`);
        fs.cpSync(source, root, { recursive: true });
        return { root, repoId: indexRepository(root, { adapters, ...options }).repoId };
    }
    const edgesOf = (repoId: number): TruthEdge[] =>
        loadImportEdges(getDb(), repoId).map((e) => ({ source: e.source, target: e.target })).sort(byEdge);
    const entriesOf = (repoId: number) => getDb().select({ path: entryPoints.path, declaredBy: entryPoints.declaredBy }).from(entryPoints)
        .where(eq(entryPoints.repoId, repoId)).all().sort(byPath);
    const stored = (repoId: number, rel: string) =>
        getDb().select({ id: files.id, specifiers: files.importSpecifiers, declares: files.declares }).from(files)
            .where(and(eq(files.repoId, repoId), eq(files.path, rel))).get();

    describe(`${adapter.id} adapter conformance`, () => {
        beforeAll(async () => {
            await prepareLanguages(adapters);
        });

        it("the truth is complete and in order: every file listed once, sorted, with its specifiers, declares, symbols and kinds", () => {
            expect([...paths].sort()).toEqual(paths);
            expect(new Set(paths).size).toBe(paths.length);
            for (const table of [truth.specifiers, truth.declares, truth.symbols, truth.kinds]) expect(Object.keys(table).sort()).toEqual(paths);
            for (const p of paths) expect(Object.keys(truth.kinds[p]).sort()).toEqual([...new Set(truth.specifiers[p])].sort());
            expect([...truth.edges].sort(byEdge)).toEqual(truth.edges);
            expect([...truth.entryPoints].sort(byPath)).toEqual(truth.entryPoints);
            expect(paths).toContain(truth.broken.path);
            for (const p of Object.keys(truth.chunks)) expect(paths).toContain(p);
        });

        it("K1 claims each of its extensions", () => {
            expect(adapter.extensions.length).toBeGreaterThan(0);
            for (const ext of adapter.extensions) expect(adapterFor(`x${ext}`, adapters)).toBe(adapter);
        });

        it("K2 parses every truth file without throwing, twice, to the same products", () => {
            for (const p of paths) expect(parse(p), p).toEqual(parse(p));
        });

        it("K3 reads each file's specifiers", () => {
            for (const p of paths) expect(parse(p).imports, p).toEqual(truth.specifiers[p]);
        });

        it("K4 reads each file's declares, sorted", () => {
            for (const p of paths) expect(parse(p).declares, p).toEqual(truth.declares[p]);
        });

        it("K5 reads each file's symbols", () => {
            for (const p of paths) expect(parse(p).symbols, p).toEqual(truth.symbols[p]);
        });

        it("K6 cuts the listed files' chunks as the truth says, and every file's chunks keep the invariants", () => {
            for (const [p, expected] of Object.entries(truth.chunks)){
                expect(parse(p).chunks.map((c) => ({ kind: c.kind, name: c.name, startLine: c.startLine, endLine: c.endLine })), p).toEqual(expected);
            }
            for (const p of paths){
                const text = read(p);
                const lines = linesOf(text);
                const lineCount = parse(p).lineCount;
                const all = parse(p).chunks;
                expect(new Set(all.map((c) => c.id)).size, `${p}: ids unique`).toBe(all.length);
                expect(all.at(-1), `${p}: the file summary last`).toMatchObject({ kind: "file-summary", name: "(file)", startLine: 1, endLine: Math.max(1, lineCount) });
                for (const c of all){
                    expect(c.startLine >= 1 && c.startLine <= c.endLine && c.endLine <= Math.max(1, lineCount), `${p} ${c.id}: inside the file`).toBe(true);
                    if (c.kind !== "file-summary") expect(c.text, `${p} ${c.id}: its lines`).toBe(lines.slice(c.startLine - 1, c.endLine).join("\n"));
                }
            }
        });

        it("K7 the imports-only readings: parse keeps imports and declares, scan only its imports; a file over the caps is stored so", () => {
            for (const p of paths){
                const full = parse(p);
                expect(parse(p, "parse"), p).toMatchObject({ chunks: [], symbols: [], imports: full.imports, declares: full.declares });
                expect(parse(p, "scan"), p).toMatchObject({ chunks: [], symbols: [], declares: [], imports: truth.scan?.[p] ?? full.imports });
            }

            // the largest file with a specifier, indexed with the caps lowered under its size: parsed, then scanned
            const sized = paths.filter((p) => truth.specifiers[p].length > 0).map((p) => ({ p, size: fs.statSync(path.join(source, p)).size }));
            const { p: big, size } = sized.sort((a, b) => b.size - a.size || (a.p < b.p ? -1 : 1))[0];
            const chunkCount = (id: number): number => getDb().select().from(chunks).where(eq(chunks.fileId, id)).all().length;
            const symbolCount = (id: number): number => getDb().select().from(symbols).where(eq(symbols.fileId, id)).all().length;

            const parsed = indexedCopy({ maxFileBytes: size - 1, parseMaxFileBytes: size });
            const asParsed = stored(parsed.repoId, big)!;
            expect(JSON.parse(asParsed.specifiers), `${big} parsed for its imports`).toEqual(truth.specifiers[big]);
            expect(JSON.parse(asParsed.declares)).toEqual(truth.declares[big]);
            expect([chunkCount(asParsed.id), symbolCount(asParsed.id)]).toEqual([0, 0]);

            const scanned = indexedCopy({ maxFileBytes: size - 1, parseMaxFileBytes: size - 1 });
            const asScanned = stored(scanned.repoId, big)!;
            expect(JSON.parse(asScanned.specifiers), `${big} scanned for its imports`).toEqual(truth.scan?.[big] ?? truth.specifiers[big]);
            expect(JSON.parse(asScanned.declares)).toEqual([]);
            expect([chunkCount(asScanned.id), symbolCount(asScanned.id)]).toEqual([0, 0]);
        });

        it("K8 reads the broken file around its error", () => {
            expect(parse(truth.broken.path).imports).toEqual(truth.broken.specifiers);
        });

        it("K9 a full run indexes the truth's files, leaves out the excluded ones, and stores its edges and entry points", () => {
            const { repoId } = indexedCopy();
            const rows = getDb().select({ path: files.path, language: files.language, isTest: files.isTest, lineCount: files.lineCount }).from(files)
                .where(eq(files.repoId, repoId)).all();
            expect(rows.filter((r) => adapterFor(r.path, adapters) === adapter).sort(byPath)).toEqual(truth.files);
            for (const p of truth.excluded) expect(rows.map((r) => r.path), p).not.toContain(p);
            expect(edgesOf(repoId)).toEqual(truth.edges);
            expect(entriesOf(repoId)).toEqual(truth.entryPoints);
        });

        it("K10 names each specifier's kind", () => {
            const { root, repoId } = indexedCopy();
            const current = loadStoredFiles(getDb(), repoId);
            const resolver = createResolvers(adapters, {
                root, fileSet: new Set(current.keys()), manifests: listManifests(root, adapters), readText: repoTextReader(root), cache: new Map(),
            }, current).get(adapter.id)!;
            for (const p of paths){
                for (const [specifier, kind] of Object.entries(truth.kinds[p])) expect(resolver.kindOf(p, specifier), `${p} ${specifier}`).toBe(kind);
            }
        });

        it("K11 a second full run changes nothing", () => {
            const { root, repoId } = indexedCopy();
            const second = indexRepository(root, { adapters });
            expect(second.changed).toBe(0);
            expect(edgesOf(repoId)).toEqual(truth.edges);
        });

        it.each(truth.edits.map((e) => [e.description, e] as const))("K12 %s: the update, from a warmed state, gives the truth's edges, as a full run does", (_d, edit) => {
            const { root, repoId } = indexedCopy();
            // a no-op update first: its resolution state has every adapter's cache filled, as a worker's would
            const warm = applyFileChanges(root, [paths[0]], { adapters });
            for (const [rel, text] of Object.entries(edit.writes)){
                const absolute = path.join(root, rel);
                if (text === null) fs.rmSync(absolute);
                else{
                    fs.mkdirSync(path.dirname(absolute), { recursive: true });
                    fs.writeFileSync(absolute, text);
                }
            }
            applyFileChanges(root, Object.keys(edit.writes), { adapters, resolution: warm.resolution });
            expect(edgesOf(repoId)).toEqual(edit.edgesAfter);

            const twin = makeTempDir(`neb-conformance-twin-${adapter.id}-`);
            fs.cpSync(root, twin, { recursive: true });
            const fresh = indexRepository(twin, { adapters }).repoId;
            expect(edgesOf(fresh)).toEqual(edit.edgesAfter);
            expect(entriesOf(fresh)).toEqual(entriesOf(repoId));
        });

        it("K13 a CRLF copy reads the same in every reading, and a byte-order mark changes no product", () => {
            for (const p of paths){
                const { lf, crlf, bom } = k13Texts(read(p));
                for (const reading of READINGS){
                    const a = parse(p, reading, lf);
                    const b = parse(p, reading, crlf);
                    expect({ imports: b.imports, declares: b.declares, symbols: b.symbols }, `${p} ${reading} CRLF`)
                        .toEqual({ imports: a.imports, declares: a.declares, symbols: a.symbols });
                    expect(parse(p, reading, bom), `${p} ${reading} BOM`).toEqual(a);
                }
            }
        });
    });
}
