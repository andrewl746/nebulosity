/**
 * Rust's specifier syntax (the E4 plan's Task R), shared by the tree reading (parse.ts), the line scan (scan.ts) and the
 * resolver (resolve.ts). Pure string work: no parser here.
 *
 * Every reference is one string:
 * - `mod:<inline>|<name>` for `mod name;`, `mod:<inline>|<name>@<path>` with `#[path = "<path>"]`;
 * - `use:<inline>|<path>` for each leaf of a use tree, `<path> as <alias>` for a rename, `<prefix>::*` for a glob;
 * - `extern:<name>` for `extern crate name;`;
 * - `path:<inline>|<a::b::c>` for a path of two or more segments in code.
 * `<inline>` is the inline-module path the reference sits in (`tests`, `a::b`), empty at file level.
 */

export type RustSpecifier =
    | { form: "mod"; inline: string[]; name: string; path: string | null }
    | { form: "use" | "path"; inline: string[]; path: string; alias: string | null }
    | { form: "extern"; name: string };

/** `a::b` joined after a prefix that may be empty. */
export function joinPath(prefix: string, rest: string): string {
    return prefix === "" ? rest : `${prefix}::${rest}`;
}

export function modSpecifier(inline: readonly string[], name: string, path: string | null): string {
    return `mod:${inline.join("::")}|${name}${path === null ? "" : `@${path}`}`;
}

export function specifierForUse(inline: readonly string[], leaf: string): string {
    return `use:${inline.join("::")}|${leaf}`;
}

export function pathSpecifier(inline: readonly string[], path: string): string {
    return `path:${inline.join("::")}|${path}`;
}

/** The parts of a specifier this adapter wrote, or null for a string it didn't. */
export function parseSpecifier(specifier: string): RustSpecifier | null {
    if (specifier.startsWith("extern:")) return { form: "extern", name: specifier.slice("extern:".length) };
    const colon = specifier.indexOf(":");
    const bar = specifier.indexOf("|");
    if (colon === -1 || bar < colon) return null;
    const form = specifier.slice(0, colon);
    const inlineText = specifier.slice(colon + 1, bar);
    const inline = inlineText === "" ? [] : inlineText.split("::");
    const body = specifier.slice(bar + 1);
    if (form === "mod"){
        const at = body.indexOf("@");
        return at === -1 ? { form, inline, name: body, path: null } : { form, inline, name: body.slice(0, at), path: body.slice(at + 1) };
    }
    if (form === "use" || form === "path"){
        const as = body.lastIndexOf(" as ");
        return as === -1 ? { form, inline, path: body, alias: null } : { form, inline, path: body.slice(0, as), alias: body.slice(as + " as ".length) };
    }
    return null;
}

/** A path's segments: `crate::a::B` → ["crate", "a", "B"]; a leading `::` gives a first segment "". */
export function segmentsOf(path: string): string[] {
    return path.split("::");
}

/** The crates whose paths never name the repo's code: the standard library's. */
export const STANDARD_CRATES: ReadonlySet<string> = new Set(["std", "core", "alloc"]);

/** An identifier as a file or crate name: a raw identifier's `r#` dropped. */
export function unraw(name: string): string {
    return name.startsWith("r#") ? name.slice(2) : name;
}

/**
 * The leaves of a use tree written as text (`crate::a::{self, b::*, C as D}`), as the tree reading writes them, or null
 * when the text isn't a use tree (a malformed construct gives no specifier). For the line scan, which has no tree.
 * Comments are no part of a tree: a block comment inside a group, or a line comment after it, is dropped first.
 */
export function leavesOfUseText(written: string): string[] | null {
    const text = written.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/, "");
    const tokens: string[] = [];
    const token = /\s*(::|[{},*]|(?:r#)?[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*)/y;
    let at = 0;
    while (at < text.length){
        token.lastIndex = at;
        const match = token.exec(text);
        if (match === null){
            if (/^\s*$/.test(text.slice(at))) break;
            return null;
        }
        tokens.push(match[1]);
        at = token.lastIndex;
    }

    let i = 0;
    const leaves: string[] = [];
    const isName = (t: string | undefined): boolean => t !== undefined && /^(?:r#)?[A-Za-z_$][A-Za-z0-9_]*$/.test(t);

    // tree := '{' list '}' | '*' | path ['::' ('{' list '}' | '*') | 'as' name]
    const tree = (prefix: string, inGroup: boolean): boolean => {
        if (tokens[i] === "{") return group(prefix);
        if (tokens[i] === "*"){
            i++;
            leaves.push(joinPath(prefix, "*"));
            return true;
        }
        let path = "";
        if (tokens[i] === "::"){
            path = "::";
            i++;
        }
        if (!isName(tokens[i]) || tokens[i] === "as") return false;
        path += tokens[i++];
        while (tokens[i] === "::" && isName(tokens[i + 1])){
            path += `::${tokens[i + 1]}`;
            i += 2;
        }
        const full = path === "self" && inGroup ? prefix : joinPath(prefix, path);
        if (tokens[i] === "::"){
            i++;
            if (tokens[i] === "{") return group(full);
            if (tokens[i] === "*"){
                i++;
                leaves.push(`${full}::*`);
                return true;
            }
            return false;
        }
        if (tokens[i] === "as"){
            if (!isName(tokens[i + 1])) return false;
            if (full !== "") leaves.push(`${full} as ${tokens[i + 1]}`);
            i += 2;
            return true;
        }
        if (full !== "") leaves.push(full);
        return true;
    };
    const group = (prefix: string): boolean => {
        i++;   // "{"
        while (tokens[i] !== "}"){
            if (!tree(prefix, true)) return false;
            if (tokens[i] === ",") i++;
            else if (tokens[i] !== "}") return false;
        }
        i++;   // "}"
        return true;
    };

    if (!tree("", false) || i !== tokens.length) return null;
    return leaves;
}
