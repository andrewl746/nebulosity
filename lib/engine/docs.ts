import type { DocPointer } from "../contracts";
import type { Db } from "../db/client";
import { loadAllDocLinks, loadDocLinksTo, loadDocs } from "../db/store/docs";
import type { DocLinkKind, DocLinkRow } from "../db/schema";
import { isPlainFolderGlob } from "../index/docs";
import { dirOf } from "../index/paths";

/** A doc whose name holds one of these is about how the code is organized. */
export const ARCHITECTURE_WORDS = ["architecture", "design", "overview", "organization", "organisation", "structure", "contributing",
    "agents", "claude", "copilot-instructions", "conventions", "layers"];
/** How many docs an answer names. */
export const DOCS_SHOWN = 5;

const KIND_RANK: Record<DocLinkKind, number> = { applies: 3, readme: 2, mentions: 1 };
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const depth = (p: string): number => (p === "" ? 0 : p.split("/").length);
/** An applies glob that is one folder and everything under it ("src/vs/**"), not a file pattern. */
const plainGlob = (l: DocLinkRow): number => (l.kind === "applies" && isPlainFolderGlob(l.detail ?? "") ? 1 : 0);

export function hasArchitectureWord(docPath: string): boolean {
    const name = docPath.slice(docPath.lastIndexOf("/") + 1).toLowerCase().replace(/\.(md|mdx|mdc)$/, "");
    return ARCHITECTURE_WORDS.some((word) => name.includes(word));
}

/** A path and its folders above it, the root left out: "src/app/loader.ts" → src/app/loader.ts, src/app, src. */
export function selfAndAncestors(targetPath: string): string[] {
    const out: string[] = [];
    for (let p = targetPath; p !== ""; p = dirOf(p)) out.push(p);
    return out;
}

/** Compares number tuples, largest first. */
const byKeyDesc = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
};

const pointer = (l: DocLinkRow, title: string): DocPointer => ({
    path: l.docPath, title,
    reason: { kind: l.kind, target: l.targetPath, ...(l.detail !== null ? { detail: l.detail } : {}), count: l.count },
});

/**
 * The docs about a place (ADR-054): links to it or its folders above it (not the root), each doc shown by its strongest
 * link, ranked by kind (applies, readme, mentions), deeper target, plain-folder glob, a name about architecture, count, path.
 */
export function rankDocsAbout(links: readonly DocLinkRow[], titles: ReadonlyMap<string, string>, limit = DOCS_SHOWN): DocPointer[] {
    const linkKey = (l: DocLinkRow): number[] => [KIND_RANK[l.kind], depth(l.targetPath), plainGlob(l), l.count];
    const best = new Map<string, DocLinkRow>();
    for (const l of links){
        const held = best.get(l.docPath);
        if (!held || byKeyDesc(linkKey(l), linkKey(held)) < 0) best.set(l.docPath, l);
    }
    const docKey = (l: DocLinkRow): number[] => [KIND_RANK[l.kind], depth(l.targetPath), plainGlob(l), Number(hasArchitectureWord(l.docPath)), l.count];
    return [...best.values()]
        .sort((a, b) => byKeyDesc(docKey(a), docKey(b)) || compare(a.docPath, b.docPath))
        .slice(0, limit)
        .map((l) => pointer(l, titles.get(l.docPath) ?? l.docPath));
}

/**
 * The docs to read first about the whole repo (ADR-054): the root README; docs named for architecture (shallower first,
 * then more places mentioned, then path; one that also applies to a non-root folder goes before all of them); docs that apply to a folder (the shallowest folder, a plain-folder glob, path).
 */
export function rankDocsToReadFirst(docs: readonly { path: string; title: string }[], links: readonly DocLinkRow[], limit = DOCS_SHOWN): DocPointer[] {
    const out: DocPointer[] = [];
    const add = (p: DocPointer): void => {
        if (out.length < limit && !out.some((o) => o.path === p.path)) out.push(p);
    };
    const mentioned = new Map<string, number>();
    for (const l of links) if (l.kind === "mentions") mentioned.set(l.docPath, (mentioned.get(l.docPath) ?? 0) + 1);

    const readme = docs.find((d) => /^readme\.mdx?$/i.test(d.path));
    if (readme) add({ path: readme.path, title: readme.title });
    const appliesToFolder = new Set(links.filter((l) => l.kind === "applies" && l.targetPath !== "").map((l) => l.docPath));
    docs.filter((d) => hasArchitectureWord(d.path))
        .sort((a, b) => Number(appliesToFolder.has(b.path)) - Number(appliesToFolder.has(a.path)) || depth(a.path) - depth(b.path) || (mentioned.get(b.path) ?? 0) - (mentioned.get(a.path) ?? 0) || compare(a.path, b.path))
        .forEach((d) => add({ path: d.path, title: d.title }));
    const titles = new Map(docs.map((d) => [d.path, d.title]));
    links.filter((l) => l.kind === "applies")
        .sort((a, b) => depth(a.targetPath) - depth(b.targetPath) || plainGlob(b) - plainGlob(a) || compare(a.docPath, b.docPath))
        .forEach((l) => add(pointer(l, titles.get(l.docPath) ?? l.docPath)));
    return out;
}

export function docsAbout(db: Db, repoId: number, targetPath: string): DocPointer[] {
    const links = loadDocLinksTo(db, repoId, selfAndAncestors(targetPath));
    if (links.length === 0) return [];
    return rankDocsAbout(links, new Map(loadDocs(db, repoId).map((d) => [d.path, d.title])));
}

export function docsToReadFirst(db: Db, repoId: number): DocPointer[] {
    return rankDocsToReadFirst(loadDocs(db, repoId), loadAllDocLinks(db, repoId));
}
