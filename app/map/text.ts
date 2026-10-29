/** A run of a summary: prose, or a code identifier the panel draws in monospace. */
export type TextPart = { text: string; code: boolean };

/** Code is a pair of backticks around one or more non-backtick characters, the way the summaries write identifiers. */
const CODE = /`([^`]+)`/g;

/**
 * A summary's text cut into prose and code (VISUAL_REFRESH.md §5): `vs/base` is drawn as code, never with its
 * backticks. A backtick with no partner, or an empty pair, stays literal: it's text the model wrote, not markup.
 */
export function inlineCode(text: string): TextPart[] {
    const parts: TextPart[] = [];
    let at = 0;
    for (const match of text.matchAll(CODE)){
        if (match.index > at) parts.push({ text: text.slice(at, match.index), code: false });
        parts.push({ text: match[1], code: true });
        at = match.index + match[0].length;
    }
    if (at < text.length) parts.push({ text: text.slice(at), code: false });
    return parts;
}

/** Words that end in a period without ending the sentence. */
const ABBREVIATIONS: ReadonlySet<string> = new Set(["e.g", "i.e", "etc", "vs", "cf"]);
/**
 * What the next sentence can start with, code included: summaries often start a sentence with an identifier
 * ("`common/` holds…"), and leaving the backtick out made a whole paragraph the lead. "e.g. `foo`" still doesn't
 * split: the abbreviation check catches it.
 */
const STARTS_SENTENCE = /[A-Z0-9"'(“‘`]/;

/** The word that ends at `end` (the stop's position), without an opening parenthesis: "(i.e" → "i.e". */
function wordBefore(text: string, end: number): string {
    let start = end;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    return text.slice(start, end).replace(/^\(/, "").toLowerCase();
}

/** A blank line, the break between two paragraphs. parseSummary leaves exactly one, but any whitespace on it counts. */
const PARAGRAPH_BREAK = /\n\s*\n/;

/**
 * A summary's lead, which the panel shows first, and the rest, behind "Full summary" (VISUAL_REFRESH.md §5). A summary
 * in paragraphs leads with its whole first paragraph, which the prompt keeps to a sentence or two on what the thing is
 * for (D10). One in a single block, the way an older prompt wrote nearly all of them, leads with its first sentence.
 * A sentence ends at ".", "!" or "?" outside code, followed by whitespace and then something a sentence starts with,
 * unless the word before the period is an abbreviation. "3.4" and `main.ts` never split, since no space follows
 * their periods. When in doubt it doesn't split: a longer lead costs a line, a cut-off one costs the meaning.
 */
export function splitSummary(summary: string): { lead: string; rest: string } {
    const text = summary.trim();
    const paragraph = PARAGRAPH_BREAK.exec(text);
    if (paragraph) return { lead: text.slice(0, paragraph.index), rest: text.slice(paragraph.index + paragraph[0].length) };

    let inCode = false;

    for (let i = 0; i < text.length; i++){
        const ch = text[i];
        if (ch === "`"){
            // code opens only where inlineCode would draw it: a partner further on, with something between the two.
            // A lone backtick is text; counting it as an opening hid every sentence end after it (deferred minor).
            if (inCode) inCode = false;
            else if (text[i + 1] !== "`" && text.indexOf("`", i + 2) !== -1) inCode = true;
            continue;
        }
        if (inCode || (ch !== "." && ch !== "!" && ch !== "?")) continue;

        let next = i + 1;
        if (next >= text.length || !/\s/.test(text[next])) continue;
        while (next < text.length && /\s/.test(text[next])) next++;
        if (next >= text.length || !STARTS_SENTENCE.test(text[next])) continue;
        if (ch === "." && ABBREVIATIONS.has(wordBefore(text, i))) continue;

        return { lead: text.slice(0, i + 1), rest: text.slice(next) };
    }
    return { lead: text, rest: "" };
}

/**
 * Past this many characters the source viewer shows code plain: coloring runs in one go on the main thread, and a 1 MB
 * file blocked the Map for about 350 ms (deferred minor). Measured on VS Code's own TypeScript (2026-10-13): 50,000
 * characters color in ~15 ms, 200,000 in 55–70 ms, 400,000 in 100–120 ms, so this keeps a viewer opening inside the
 * 100 ms an interaction gets (S3). Lives here, not in syntax.ts, so the viewer can say why without loading the
 * highlighter.
 */
export const MAX_COLORED_CHARS = 200_000;

export function tooLargeToColor(code: string): boolean {
    return code.length > MAX_COLORED_CHARS;
}
