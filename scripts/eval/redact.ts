/**
 * Grader redaction for Eval #3 (ADR-060, R-M, R-AD): before the blind sheets, the words that name Nebulosity or its
 * tools become neutral ones, so a grader can't tell the arms apart by them. "The index" and "the import graph" stay:
 * they are ordinary words, and the sheets' count of them is disclosed. The rules run in order; each replacement is
 * listed, so the record says what changed. Pure.
 *
 * Articles: a match swallows the article and the "tool"/"call"/"answer"/"result" word around it, and brings its own
 * ("a search"), so no sentence gets "the a search". The one exception is a bare "<name> tool" that follows a modifier
 * ("a code search tool", "the web search tool"): there only "search" is written, since the modifier's article stands.
 */
const TOOLS = "overview|describe|search|imports|architecture|calls|show_on_map";
const TOOL_WORD = "(?:tools?|calls?|answers?|results?)";
/** A replacement, or a function of the text before the match (which decides whether it needs its own article). */
type To = string | ((before: string) => string);
const RULES: readonly { re: RegExp; to: To }[] = [
    { re: new RegExp(`(?:(?:the|a|an) )?\`?mcp__nebulosity__\\w+\`?(?: ${TOOL_WORD}\\b)?`, "gi"), to: "a search" },
    { re: /\bNebulosity['’]s\b/gi, to: "the" },
    { re: /\b(?:(?:the|a) )?Nebulosity(?: code-index| MCP)?(?: tools?| server| index)?\b/gi, to: "the index" },
    // a tool's name written as a tool: in backticks before tool, call, answer or result, or bare before "tool"; ordinary words
    // ("the search results", "the overview answers it") stay
    { re: new RegExp(`(?<![\\w\`])(?:(?:the|a|an) )?\`(?:${TOOLS})\` ${TOOL_WORD}\\b`, "gi"), to: "a search" },
    // bare: after a modifier word ("a code search tool") the name alone is written; otherwise "a search"
    { re: new RegExp(`\\b(?:(?:the|a|an) )?(?:${TOOLS}) tools?\\b`, "gi"), to: (before) => (/\w $/.test(before) ? "search" : "a search") },
];

export type Redaction = { from: string; to: string; count: number };

/** Whether a replacement starts a sentence: at the start, after . ! ? or :, or at a line's start after markdown marks. */
const startsSentence = (before: string): boolean => /(?:^|[.!?:]\s+|\n[\s>*#-]*)$/.test(before);

export function redact(text: string): { text: string; redactions: Redaction[] } {
    const redactions: Redaction[] = [];
    let out = text;
    for (const { re, to } of RULES){
        out = out.replace(re, (match: string, offset: number, whole: string) => {
            const before = whole.slice(0, offset);
            // a match that carries its own article is replaced whole ("a search"); only an article-less one may use the bare form
            const word = typeof to === "string" ? to : /^(?:the|a|an) /i.test(match) ? "a search" : to(before);
            const seen = redactions.find((r) => r.from === match && r.to === word);
            if (seen) seen.count++;
            else redactions.push({ from: match, to: word, count: 1 });
            return startsSentence(before) ? word[0].toUpperCase() + word.slice(1) : word;
        });
    }
    return { text: out, redactions };
}
