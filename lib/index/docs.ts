/**
 * Which docs talk about which folders (ADR-054), read from the repo's Markdown at index time, with no model: an
 * instructions file's applyTo (or a Cursor rule's globs), a folder's own README, and the folder and file paths a doc
 * mentions. describe and overview point at these, so a reader (or Claude Code) finds the repo's own rules.
 */
import type { DocFacts, DocLinkRow } from "../db/schema";
import { dirOf } from "./paths";

export type { DocFacts, DocLinkKind, DocLinkRow } from "../db/schema";
/** What a mention can name: the index's folders and files, and folder tails one folder alone ends with. */
export type KnownPaths = { folders: ReadonlySet<string>; files: ReadonlySet<string>; suffixes: ReadonlyMap<string, string | null> };

const README = /^readme\.mdx?$/i;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The lines between a first line "---" and the next "---" as key → value (one-line YAML), and the text after them. */
export function splitFrontMatter(text: string): { fields: Map<string, string>; body: string } {
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const fields = new Map<string, string>();
    if (!clean.startsWith("---\n")) return { fields, body: clean };
    const end = clean.indexOf("\n---", 3);
    if (end === -1) return { fields, body: clean };
    for (const line of clean.slice(4, end).split("\n")){
        const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (m) fields.set(m[1], stripComment(m[2]).trim());
    }
    const after = clean.indexOf("\n", end + 4);
    return { fields, body: after === -1 ? "" : clean.slice(after + 1) };
}

/** A value without its YAML trailing comment: a "#" at the start or after whitespace, outside quotes (F22). */
function stripComment(value: string): string {
    let quote = "";
    for (let i = 0; i < value.length; i++){
        const c = value[i];
        if (quote){
            if (c === quote) quote = "";
        } else if (c === '"' || c === "'"){
            quote = c;
        } else if (c === "#" && (i === 0 || /\s/.test(value[i - 1]))){
            return value.slice(0, i);
        }
    }
    return value;
}

/** The first level-one heading, else the file's name without its extension. */
export function docTitle(docPath: string, body: string): string {
    const m = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body);
    if (m) return m[1].trim();
    return docPath.slice(docPath.lastIndexOf("/") + 1).replace(/\.(md|mdx|mdc)$/i, "");
}

const unquote = (s: string): string => {
    const t = s.trim();
    return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1).trim() : t;
};

/** Whether a "{…}" value is one brace group from its first character to its last. */
function oneGroup(s: string): boolean {
    let depth = 0;
    for (let i = 0; i < s.length; i++){
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) return i === s.length - 1;
    }
    return false;
}

/** An applyTo or globs value as globs: quotes off, a YAML list opened, commas outside braces split, one whole brace group opened. */
export function splitGlobs(value: string): string[] {
    let v = unquote(value);
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < v.length; i++){
        if (v[i] === "{") depth++;
        else if (v[i] === "}") depth = Math.max(0, depth - 1);
        else if (v[i] === "," && depth === 0){
            parts.push(v.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(v.slice(start));
    return parts.map(unquote).filter((p) => p !== "").flatMap((p) => (p.startsWith("{") && oneGroup(p) ? splitGlobs(p.slice(1, -1)) : [p]));
}

/** The folder a glob is about: the segments before the first one with a wildcard or a brace; a glob that is one file names its folder. */
export function globFolder(glob: string): string {
    const segments = glob.replace(/^\.\//, "").split("/");
    const literal: string[] = [];
    for (const s of segments){
        if (/[*?[{]/.test(s)) break;
        literal.push(s);
    }
    if (literal.length === segments.length && /\.[A-Za-z0-9]+$/.test(literal[literal.length - 1] ?? "")) literal.pop();
    return literal.join("/");
}

/** Path-like words of two or more segments: not part of a URL, cut before a wildcard segment, trailing punctuation off. */
export function mentionTokens(body: string): string[] {
    const tokens: string[] = [];
    for (const m of body.matchAll(/[A-Za-z0-9_@.*-]+(?:\/[A-Za-z0-9_@.*-]+)+\/?/g)){
        const start = m.index ?? 0;
        if (start > 0 && /[:/]/.test(body[start - 1])) continue;   // inside https://… or a longer path
        const kept: string[] = [];
        for (const s of m[0].replace(/\/+$/, "").split("/")){
            if (s.includes("*")) break;
            kept.push(s);
        }
        const token = kept.join("/").replace(/^\.\//, "").replace(/[.,;:]+$/, "");
        if (token.includes("/")) tokens.push(token);
    }
    return tokens;
}

/** Every folder's tails of two or more segments ("editor/browser" for "src/editor/browser"), to its folder, or null when shared. */
export function folderSuffixes(folders: Iterable<string>): Map<string, string | null> {
    const out = new Map<string, string | null>();
    for (const folder of folders){
        const segments = folder.split("/");
        for (let i = 1; i <= segments.length - 2; i++){
            const tail = segments.slice(i).join("/");
            out.set(tail, out.has(tail) && out.get(tail) !== folder ? null : folder);
        }
    }
    return out;
}

/** One doc's title and links: its applyTo/globs folders, its own folder when it's a README, and every path it mentions. */
export function docLinks(docPath: string, text: string, known: KnownPaths): { facts: DocFacts; links: DocLinkRow[] } {
    const { fields, body } = splitFrontMatter(text);
    const links: DocLinkRow[] = [];
    const folder = dirOf(docPath);

    if (README.test(docPath.slice(docPath.lastIndexOf("/") + 1)) && (folder === "" || known.folders.has(folder))){
        links.push({ docPath, targetPath: folder, kind: "readme", count: 1, detail: null });
    }
    for (const key of ["applyTo", "globs"]){
        const value = fields.get(key);
        if (!value) continue;
        for (const glob of splitGlobs(value)){
            const target = globFolder(glob);
            if (target !== "" && !known.folders.has(target)) continue;
            if (!links.some((l) => l.kind === "applies" && l.targetPath === target)) links.push({ docPath, targetPath: target, kind: "applies", count: 1, detail: glob });
        }
    }
    const counts = new Map<string, number>();
    for (const token of mentionTokens(body)){
        const target = known.folders.has(token) || known.files.has(token) ? token : known.suffixes.get(token) ?? null;
        if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    for (const [targetPath, count] of counts) links.push({ docPath, targetPath, kind: "mentions", count, detail: null });

    links.sort((a, b) => compare(a.targetPath, b.targetPath) || compare(a.kind, b.kind));
    return { facts: { path: docPath, title: docTitle(docPath, body) }, links };
}
