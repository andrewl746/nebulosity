/**
 * An identifier as separate lowercase words, so a word search can find it:
 * "openEditor" → "open editor", "HTMLParser" → "html parser", "get_value" → "get value".
 * The code search index stores this next to the raw name (PIVOT_SPEC.md §4.1, code_fts),
 * and search splits identifiers in queries the same way.
 */
export function splitIdentifier(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")       // fooBar → foo Bar, utf8Decode → utf8 Decode
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")    // HTMLParser → HTML Parser
        .replace(/[^\p{L}\p{N}]+/gu, " ")              // _ $ - . { } and anything else between words
        .trim()
        .toLowerCase();
}
