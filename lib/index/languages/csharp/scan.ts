/**
 * C#'s scan reading (ADR-053's third reading, the E4 plan's Task C): a file from 5 MB to 20 MB is read line by line for
 * its `using …;` and `namespace …` lines, with no syntax tree, so a giant generated file can't grow WebAssembly memory.
 *
 * A using's trailing type arguments give its arity, as the full reading writes it (`using static A.Box<int>;` is
 * static:A.Box`1). Known differences from the full reading: no type or qtype specifier (they need the tree); a target
 * with type arguments before its last segment (`A.Outer<int>.Inner`) is skipped; a nested block
 * namespace reads as written (`namespace Pricing` inside `namespace Shop.Core` gives ns:Pricing, not ns:Shop.Core.Pricing);
 * a using line inside a block comment is read.
 */

import { withArity } from "./arity";

const USING_LINE = /^\s*(global\s+)?using\s+([^;]*);/;
const ALIAS = /^(@?[A-Za-z_]\w*)\s*=\s*(.+)$/;
const STATIC = /^static\s+(.+)$/;
const NAMESPACE_LINE = /^\s*namespace\s+(@?[A-Za-z_][\w.@]*)/;
/** A name a using directive can hold: dotted identifiers, an optional global:: and trailing type arguments. */
const NAME = /^(global::)?@?[A-Za-z_]\w*(\.@?[A-Za-z_]\w*)*(<.*>)?$/;

/** How many type arguments a list's inside holds: its commas outside any nested `<…>`, plus one. */
function argumentCount(inside: string): number {
    let depth = 0;
    let commas = 0;
    for (const ch of inside){
        if (ch === "<") depth++;
        else if (ch === ">") depth--;
        else if (ch === "," && depth === 0) commas++;
    }
    return commas + 1;
}

/**
 * A using target as the full reading writes it: no whitespace, no global::, no `@`, and trailing type arguments as
 * their arity (`A.Box<int, string>` → A.Box`2, arity.ts).
 */
function dotted(raw: string): string | null {
    const compact = raw.replace(/\s+/g, "");
    if (!NAME.test(compact)) return null;
    const open = compact.indexOf("<");   // an identifier holds no "<", so the first one opens the trailing arguments
    const name = (open === -1 ? compact : compact.slice(0, open)).replace(/^global::/, "")
        .split(".").map((s) => (s.startsWith("@") ? s.slice(1) : s)).join(".");
    return open === -1 ? name : withArity(name, argumentCount(compact.slice(open + 1, -1)));
}

function usingOf(line: string): string | null {
    const match = USING_LINE.exec(line);
    if (match === null) return null;
    const isGlobal = match[1] !== undefined;
    const body = match[2].trim();
    const alias = ALIAS.exec(body);
    if (alias !== null){
        const target = dotted(alias[2]);
        const name = alias[1].startsWith("@") ? alias[1].slice(1) : alias[1];
        return target === null ? null : `${isGlobal ? "galias" : "alias"}:${name}=${target}`;
    }
    const isStatic = STATIC.exec(body);
    const target = dotted(isStatic === null ? body : isStatic[1]);
    if (target === null) return null;
    if (isStatic !== null) return `${isGlobal ? "gstatic" : "static"}:${target}`;
    return `${isGlobal ? "global" : "using"}:${target}`;
}

/** The specifiers of the file's using and namespace lines, in line order, each once. */
export function scanCsharp(text: string): string[] {
    const out = new Set<string>();
    for (const raw of text.split("\n")){
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        const using = usingOf(line);
        if (using !== null){
            out.add(using);
            continue;
        }
        const namespace = NAMESPACE_LINE.exec(line);
        if (namespace !== null) out.add(`ns:${dotted(namespace[1]) ?? namespace[1]}`);
    }
    return [...out];
}
