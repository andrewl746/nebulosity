import { withoutBom } from "../treesitter";
import { modSpecifier, unraw, specifierForUse, leavesOfUseText } from "./syntax";

/**
 * The scan reading of a Rust file (over 5 MB, ADR-053): its references read line by line, with no tree. It sees three
 * forms, each on one line: `mod x;`, `use …;` and `extern crate x;` (a visibility and leading `#[…]` attributes allowed,
 * a trailing `//` comment too). Having no tree, it knows no inline module and no `#[path]` on the line above, and it
 * reads no path in code: `mod:|x`, `use:|<leaf>` and `extern:x` only (truth.scan lists the fixture's differences).
 */

const PREFIX = String.raw`^(?:#\[[^\]]*\]\s*)*(?:pub(?:\s*\([^)]*\))?\s+)?`;
const NAME = String.raw`((?:r#)?[A-Za-z_][A-Za-z0-9_]*)`;
const END = String.raw`\s*;\s*(?:\/\/.*)?$`;
const MOD_LINE = new RegExp(`${PREFIX}mod\\s+${NAME}${END}`);
const USE_LINE = new RegExp(`${PREFIX}use\\s+([^;]+?)${END}`);
const EXTERN_LINE = new RegExp(`${PREFIX}extern\\s+crate\\s+${NAME}(?:\\s+as\\s+${NAME})?${END}`);

export function scanRust(text: string): string[] {
    const found = new Set<string>();
    for (const raw of withoutBom(text).split("\n")){
        const line = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trim();
        const mod = MOD_LINE.exec(line);
        if (mod !== null){
            found.add(modSpecifier([], mod[1], null));
            continue;
        }
        const extern = EXTERN_LINE.exec(line);
        if (extern !== null){
            found.add(`extern:${unraw(extern[1])}`);
            continue;
        }
        const use = USE_LINE.exec(line);
        if (use !== null) for (const leaf of leavesOfUseText(use[1]) ?? []) found.add(specifierForUse([], leaf));
    }
    return [...found];
}
