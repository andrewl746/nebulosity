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

/** A title longer than this is cut, its last character an ellipsis. */
export const MAX_TITLE_CHARS = 120;

/**
 * The first level-one heading with any text in it, as plain text and at most MAX_TITLE_CHARS; else the file's name
 * without its extension. A heading that is only a badge, or a bare "#", is no title.
 */
export function docTitle(docPath: string, body: string): string {
    for (const m of body.matchAll(/^#[ \t]+(.+?)[ \t#]*$/gm)){
        // only the start of a long heading can show, and the markup patterns below would be slow on a huge line of "["
        const title = plainText(m[1].slice(0, 4_000));
        if (title === "") continue;
        if (title.length <= MAX_TITLE_CHARS) return title;
        let cut = MAX_TITLE_CHARS - 1;
        if (/[\uD800-\uDBFF]/.test(title[cut - 1])) cut--;   // never half of a character outside the BMP
        return `${title.slice(0, cut).trimEnd()}…`;
    }
    return docPath.slice(docPath.lastIndexOf("/") + 1).replace(/\.(md|mdx|mdc)$/i, "");
}

/**
 * Inline Markdown as the words a reader sees: images and badges dropped, links as their text, code as its text, and
 * outside code, HTML tags and emphasis marks off. Underscores inside a word (snake_case) and a lone "*" stay.
 */
function plainText(markdown: string): string {
    const linked = markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")       // an image or a badge: ![alt](src)
        .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")      // a reference image: ![alt][ref]
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")    // a link: [text](url); a badge's link is left with no text
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");  // a reference link: [text][ref]
    const pieces: string[] = [];
    let at = 0;
    for (const code of linked.matchAll(/(`+)(.+?)\1/g)){
        pieces.push(withoutMarks(linked.slice(at, code.index)), code[2]);
        at = (code.index ?? 0) + code[0].length;
    }
    pieces.push(withoutMarks(linked.slice(at)));
    return pieces.join("").replace(/\s+/g, " ").trim();
}

/** Text outside code without HTML tags and emphasis marks. A capitalized tag (<PageListTable />) names a component, and stays. */
function withoutMarks(text: string): string {
    return text
        .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/g, "")         // <img …>, <br/>, <b>
        .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")                          // **strong**, __strong__, ~~struck~~
        .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2")        // *em*, not 2*3*4
        .replace(/(^|\W)_(?!\s)([^_]+?)_(?!\w)/g, "$1$2");             // _em_, not snake_case
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

/** Whether a glob is one folder and everything under it ("src/vs/**"), not a pattern for some of its files ("*.css" under it). */
export function isPlainFolderGlob(glob: string): boolean {
    return /^[^*?[{]*\/\*\*$/.test(glob);
}

/** The folder a glob is about: the segments before the first one with a wildcard or a brace; a glob that is one file names its folder. */
export function globFolder(glob: string): string {
    // "/src/vs/**" and "src/vs/" mean the repo's src/vs: a leading "./" or "/" and a trailing "/" name no folder of their own
    const trimmed = glob.replace(/^\.?\/+/, "");
    const isFolder = trimmed.endsWith("/");   // "docs/v1.2/" is a folder, though its name looks like a file's
    const segments = trimmed.replace(/\/+$/, "").split("/");
    const literal: string[] = [];
    for (const s of segments){
        if (/[*?[{]/.test(s)) break;
        literal.push(s);
    }
    if (!isFolder && literal.length === segments.length && /\.[A-Za-z0-9]+$/.test(literal[literal.length - 1] ?? "")) literal.pop();
    return literal.join("/");
}

/**
 * Path-like words of two or more segments: not part of a URL, cut before a wildcard segment, trailing punctuation off.
 * A match starts only where a word starts (the lookbehind): without it, a long word with no slash was tried from each of
 * its characters, each try running to the word's end, which is quadratic (a 1 MB doc could take minutes). A match from
 * inside a word could only be a shorter copy of the one from its start, so the tokens are the same.
 */
export function mentionTokens(body: string): string[] {
    const tokens: string[] = [];
    for (const m of body.matchAll(/(?<![A-Za-z0-9_@.*-])[A-Za-z0-9_@.*-]+(?:\/[A-Za-z0-9_@.*-]+)+\/?/g)){
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
            // one link per folder: the first glob that names it, unless a plain one ("src/vs/**") comes after a file pattern
            const kept = links.find((l) => l.kind === "applies" && l.targetPath === target);
            if (!kept) links.push({ docPath, targetPath: target, kind: "applies", count: 1, detail: glob });
            else if (isPlainFolderGlob(glob) && !isPlainFolderGlob(kept.detail ?? "")) kept.detail = glob;
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
