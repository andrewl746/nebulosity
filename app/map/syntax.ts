import hljs from "highlight.js/lib/core";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import { tooLargeToColor } from "./text";

// only the languages the index reads (E4, C10: the names paths.ts's languageFor gives), so the rest of highlight.js
// stays out of the bundle
const GRAMMARS = { typescript, javascript, python, go, java, rust };
for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);

/**
 * Keywords that steer control flow. VS Code colors these pink and the rest (const, function, class) blue; highlight.js
 * gives them all one class, so they're picked out after.
 */
const CONTROL = ["import", "export", "from", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "throw", "try", "catch", "finally", "await", "yield", "as"];
const CONTROL_KEYWORD = new RegExp(`<span class="hljs-keyword">(${CONTROL.join("|")})</span>`, "g");

// lives in paths.ts, so search can name a snippet's language without loading the highlighter
export { languageFor } from "./paths";

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A file's code as HTML with a class on each token (owner review: color code like in VS Code). The colors are VS
 * Code's Dark+ palette, set in globals.css under `.syntax` (VISUAL_REFRESH.md §2, code only). Everything is escaped:
 * a file's text can never become markup. A language it doesn't know, or a file too large to color quickly, comes
 * back as plain escaped text.
 */
export function highlightCode(code: string, language: string): string {
    // a very large file stays plain: coloring it would freeze the Map (text.ts)
    if (!hljs.getLanguage(language) || tooLargeToColor(code)) return escapeHtml(code);
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
        .replace(CONTROL_KEYWORD, '<span class="hljs-keyword hljs-control">$1</span>');
}
