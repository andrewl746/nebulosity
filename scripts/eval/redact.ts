/**
 * Grader redaction for Eval #3 (ADR-060, R-M, R-AD): before the blind sheets, the words that name Nebulosity or its
 * tools become neutral ones, so a grader can't tell the arms apart by them. "The index" and "the import graph" stay:
 * they are ordinary words, and the sheets' count of them is disclosed. The rules run in order; each replacement is
 * listed, so the record says what changed. Pure.
 */
const TOOLS = "overview|describe|search|imports|architecture|calls|show_on_map";
const RULES: readonly { re: RegExp; to: string }[] = [
    { re: /`?mcp__nebulosity__\w+`?/gi, to: "a search" },
    { re: /\bNebulosity['’]s\b/gi, to: "the" },
    { re: /\b(?:(?:the|a) )?Nebulosity(?: code-index| MCP)?(?: tools?| server| index)?\b/gi, to: "the index" },
    // a tool's name written as a tool: in backticks before tool, call, answer or result, or bare before "tool"; ordinary words
    // ("the search results", "the overview answers it") stay
    { re: new RegExp(`(?<![\\w\`])(?:(?:the|a|an) )?\`(?:${TOOLS})\` (?:tools?|calls?|answers?|results?)\\b`, "gi"), to: "a search" },
    { re: new RegExp(`\\b(?:(?:the|a|an) )?(?:${TOOLS}) tools?\\b`, "gi"), to: "a search" },
];

export type Redaction = { from: string; to: string; count: number };

/** Whether a replacement starts a sentence: at the start, after . ! ? or :, or at a line's start after markdown marks. */
const startsSentence = (before: string): boolean => /(?:^|[.!?:]\s+|\n[\s>*#-]*)$/.test(before);

export function redact(text: string): { text: string; redactions: Redaction[] } {
    const redactions: Redaction[] = [];
    let out = text;
    for (const { re, to } of RULES){
        out = out.replace(re, (match: string, offset: number, whole: string) => {
            const seen = redactions.find((r) => r.from === match && r.to === to);
            if (seen) seen.count++;
            else redactions.push({ from: match, to, count: 1 });
            return startsSentence(whole.slice(0, offset)) ? to[0].toUpperCase() + to.slice(1) : to;
        });
    }
    return { text: out, redactions };
}
