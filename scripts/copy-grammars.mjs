/**
 * npm run grammars
 *
 * Copies the five tree-sitter grammars' WebAssembly files from their pinned npm packages (devDependencies, installed
 * only to be this script's source) into lib/index/languages/grammars/, where they are committed and shipped (ADR-065,
 * the design's C1): a user's install builds nothing and downloads no grammar. It also writes, beside them:
 * - grammars.json: [{ id, package, version, file, sha256 }], what lib/index/languages/grammars.test.ts checks;
 * - NOTICE.md: each grammar's package, version, license and copyright line, plus the two runtime libraries E4 adds
 *   (web-tree-sitter, smol-toml), with each package's license text, since MIT and BSD-3-Clause ask for it in copies.
 * Run it again after changing a grammar's pinned version, then commit the three outputs together.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "node_modules");
const out = path.join(root, "lib", "index", "languages", "grammars");

/** The registry's grammar ids (lib/index/languages/registry.ts) and the file each package ships. */
const GRAMMARS = [
    { id: "python", package: "tree-sitter-python", file: "tree-sitter-python.wasm" },
    { id: "go", package: "tree-sitter-go", file: "tree-sitter-go.wasm" },
    { id: "java", package: "tree-sitter-java", file: "tree-sitter-java.wasm" },
    { id: "csharp", package: "tree-sitter-c-sharp", file: "tree-sitter-c_sharp.wasm" },
    { id: "rust", package: "tree-sitter-rust", file: "tree-sitter-rust.wasm" },
];
/** The runtime libraries the grammars are read with: shipped as dependencies, credited here too. */
const RUNTIME = ["web-tree-sitter", "smol-toml"];

const pins = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pinned = { ...pins.dependencies, ...pins.devDependencies };

/** A package's version, license and LICENSE text, checked against the exact pin in package.json. */
function readPackage(name) {
    const meta = JSON.parse(fs.readFileSync(path.join(modules, name, "package.json"), "utf8"));
    if (pinned[name] !== meta.version){
        throw new Error(`${name}: node_modules has ${meta.version}, package.json pins ${pinned[name] ?? "nothing"}. Run npm ci first.`);
    }
    const licenseText = fs.readFileSync(path.join(modules, name, "LICENSE"), "utf8").replace(/\r\n/g, "\n").trim();
    const copyright = licenseText.split("\n").find((line) => /^\s*Copyright\b/i.test(line))?.trim() ?? "(no copyright line)";
    return { name, version: meta.version, license: meta.license, copyright, licenseText };
}

fs.mkdirSync(out, { recursive: true });
const entries = [];
const credits = [];
for (const grammar of GRAMMARS){
    const pkg = readPackage(grammar.package);
    const bytes = fs.readFileSync(path.join(modules, grammar.package, grammar.file));
    fs.writeFileSync(path.join(out, grammar.file), bytes);
    entries.push({ id: grammar.id, package: pkg.name, version: pkg.version, file: grammar.file, sha256: createHash("sha256").update(bytes).digest("hex") });
    credits.push({ ...pkg, what: `\`${grammar.file}\`, the ${grammar.id} grammar` });
    console.log(`[grammars] ${grammar.file}  ${pkg.name}@${pkg.version}  ${(bytes.length / 1024).toFixed(0)} KB`);
}
for (const name of RUNTIME) credits.push({ ...readPackage(name), what: "a runtime dependency" });

fs.writeFileSync(path.join(out, "grammars.json"), `${JSON.stringify(entries, null, 2)}\n`);

const notice = [
    "# Third-party notices: the tree-sitter grammars and their runtime",
    "",
    "Written by `scripts/copy-grammars.mjs` (`npm run grammars`); don't edit by hand. The `.wasm` files in this folder are",
    "copied unchanged from the npm packages below, pinned exactly in `package.json`.",
    "",
    "| Package | Version | License | Copyright | What |",
    "|---|---|---|---|---|",
    ...credits.map((c) => `| ${c.name} | ${c.version} | ${c.license} | ${c.copyright} | ${c.what} |`),
    "",
    ...credits.flatMap((c) => [`## ${c.name} ${c.version}`, "", "```", c.licenseText, "```", ""]),
].join("\n");
fs.writeFileSync(path.join(out, "NOTICE.md"), notice);
console.log(`[grammars] wrote grammars.json and NOTICE.md in ${path.relative(root, out)}`);
