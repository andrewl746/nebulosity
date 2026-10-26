/**
 * npm run grammars
 *
 * Copies the five tree-sitter grammars' WebAssembly files from their pinned npm packages (devDependencies, installed
 * only to be this script's source) into lib/index/languages/grammars/, where they are committed and shipped (ADR-065,
 * the design's C1): a user's install builds nothing and downloads no grammar.
 *
 * Each is stored gzip-compressed, as <file>.gz (the E4 final review's A-I1, ADR-058's 25.0 MB unpacked bar): WebAssembly
 * compresses to about 8% (7.54 MB to 0.58 MB for the five). The loader (lib/index/languages/treesitter.ts) decompresses
 * each once per process, about 9 ms for all five. npm's tarball is gzipped anyway, so this saves almost nothing of the
 * download; it saves the disk an install takes. gzip's bytes can differ by zlib version and system (the header's OS
 * byte), so a re-run elsewhere may rewrite a .gz with the same content: the test compares what each decompresses to,
 * never the compressed bytes.
 *
 * It also writes, beside them:
 * - grammars.json: [{ id, package, version, file, sha256 }], what lib/index/languages/grammars.test.ts checks: `file` is
 *   the package's file name (the adapter's `grammar`; the committed file is `file` + ".gz"), `sha256` that file's own
 *   bytes, before compression;
 * - NOTICE.md: each grammar's package, version, license and copyright line, plus the two runtime libraries E4 adds
 *   (web-tree-sitter, smol-toml), with each package's license text, since MIT and BSD-3-Clause ask for it in copies.
 * Run it again after changing a grammar's pinned version, then commit the outputs together.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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
    // the best compression: it's paid once, here; decompressing costs about the same at any level
    const packed = zlib.gzipSync(bytes, { level: zlib.constants.Z_BEST_COMPRESSION });
    fs.writeFileSync(path.join(out, `${grammar.file}.gz`), packed);
    fs.rmSync(path.join(out, grammar.file), { force: true });   // an uncompressed copy, as committed before A-I1
    entries.push({ id: grammar.id, package: pkg.name, version: pkg.version, file: grammar.file, sha256: createHash("sha256").update(bytes).digest("hex") });
    credits.push({ ...pkg, what: `\`${grammar.file}.gz\`, the ${grammar.id} grammar` });
    console.log(`[grammars] ${grammar.file}.gz  ${pkg.name}@${pkg.version}  ${(bytes.length / 1024).toFixed(0)} KB, ${(packed.length / 1024).toFixed(0)} KB gzipped`);
}
for (const name of RUNTIME) credits.push({ ...readPackage(name), what: "a runtime dependency" });

fs.writeFileSync(path.join(out, "grammars.json"), `${JSON.stringify(entries, null, 2)}\n`);

const notice = [
    "# Third-party notices: the tree-sitter grammars and their runtime",
    "",
    "Written by `scripts/copy-grammars.mjs` (`npm run grammars`); don't edit by hand. The `.wasm.gz` files in this folder",
    "are the `.wasm` files of the npm packages below, pinned exactly in `package.json`, gzip-compressed and otherwise",
    "unchanged: each decompresses to its package's own bytes (their sha256 is in `grammars.json`).",
    "",
    "| Package | Version | License | Copyright | What |",
    "|---|---|---|---|---|",
    ...credits.map((c) => `| ${c.name} | ${c.version} | ${c.license} | ${c.copyright} | ${c.what} |`),
    "",
    ...credits.flatMap((c) => [`## ${c.name} ${c.version}`, "", "```", c.licenseText, "```", ""]),
].join("\n");
fs.writeFileSync(path.join(out, "NOTICE.md"), notice);
console.log(`[grammars] wrote grammars.json and NOTICE.md in ${path.relative(root, out)}`);
