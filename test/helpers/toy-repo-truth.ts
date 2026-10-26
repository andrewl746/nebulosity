import type { SymbolRow } from "../../lib/db/schema";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";

/**
 * test/fixtures/toy-repo's ground truth, DERIVED BY HAND from the fixture's files and the toy's rules
 * (test/helpers/toy-adapter.ts) before the conformance kit ran: never by running the code (CLAUDE.md). Change a fixture
 * file and re-derive this by hand.
 *
 * The rules used: `use <p>` → use:<p>, the file <p>.toy, else <root>/<p>.toy for toy.json's root ("lib"); the importer
 * itself is placed with no edge. `name <N>` → name:<N>, the other files of the importer's folder that `def <N>`.
 * toy.json leaves out deps/*.toy beside it. A test file ends _test.toy, or sits in a tests/ folder. `main` makes an
 * entry point. Every specifier is internal.
 */

const fn = (name: string, line: number): SymbolRow => ({
    name, qualifiedName: name, kind: "function", startLine: line, endLine: line, exported: !name.startsWith("_"), parentQualifiedName: null,
});
const edge = (source: string, target: string): TruthEdge => ({ source, target });

/** The ten edges of a full run, sorted by source then target, each with the rule that makes it. */
const EDGES: TruthEdge[] = [
    edge("app/broken.toy", "app/greet.toy"),          // use:app/greet, the file app/greet.toy (line 1, above the error)
    edge("app/greet.toy", "app/banner.toy"),          // name:banner, defined by two other files of app/ (twins)
    edge("app/greet.toy", "app/banner_alt.toy"),      // name:banner, the second definer
    edge("app/main.toy", "app/banner.toy"),           // name:banner
    edge("app/main.toy", "app/banner_alt.toy"),       // name:banner
    edge("app/main.toy", "app/greet.toy"),            // use:app/greet
    edge("app/main.toy", "lib/strings.toy"),          // use:strings: no strings.toy at the root, so toy.json's root lib/
    edge("lib/strings_test.toy", "lib/strings.toy"),  // use:strings through lib/ (name:shout reaches the same file)
    edge("setup.toy", "app/main.toy"),                // use:app/main (setup.toy is a manifest and a code file)
    edge("tests/check.toy", "app/main.toy"),          // use:app/main
    // not edges: lib/strings.toy's use:lib/strings names itself (placed); app/broken.toy's use:missing/thing and
    // tests/check.toy's name:nothing name nothing; tests/check.toy's use:deps/vendored names an excluded file
];

const without = (...dropped: TruthEdge[]): TruthEdge[] =>
    EDGES.filter((e) => !dropped.some((d) => d.source === e.source && d.target === e.target));

export const toyRepoTruth: FixtureTruth = {
    files: [
        { path: "app/banner.toy", language: "toy", isTest: false, lineCount: 1 },
        { path: "app/banner_alt.toy", language: "toy", isTest: false, lineCount: 4 },
        { path: "app/broken.toy", language: "toy", isTest: false, lineCount: 4 },
        { path: "app/greet.toy", language: "toy", isTest: false, lineCount: 2 },
        { path: "app/main.toy", language: "toy", isTest: false, lineCount: 5 },
        { path: "lib/strings.toy", language: "toy", isTest: false, lineCount: 3 },
        { path: "lib/strings_test.toy", language: "toy", isTest: true, lineCount: 2 },
        { path: "setup.toy", language: "toy", isTest: false, lineCount: 1 },
        { path: "tests/check.toy", language: "toy", isTest: true, lineCount: 3 },
    ],
    excluded: ["deps/vendored.toy"],
    specifiers: {
        "app/banner.toy": [],
        "app/banner_alt.toy": [],
        "app/broken.toy": ["use:app/greet", "use:missing/thing"],
        "app/greet.toy": ["name:banner"],
        "app/main.toy": ["use:app/greet", "use:strings", "name:banner"],
        "lib/strings.toy": ["use:lib/strings"],
        "lib/strings_test.toy": ["use:strings", "name:shout"],
        "setup.toy": ["use:app/main"],
        "tests/check.toy": ["use:app/main", "use:deps/vendored", "name:nothing"],
    },
    declares: {
        "app/banner.toy": ["def:banner"],
        "app/banner_alt.toy": ["def:_hidden", "def:banner"],
        "app/broken.toy": ["def:fixed"],
        "app/greet.toy": ["def:greet"],
        "app/main.toy": ["main"],
        "lib/strings.toy": ["def:shout", "def:whisper"],
        "lib/strings_test.toy": [],
        "setup.toy": [],
        "tests/check.toy": [],
    },
    symbols: {
        "app/banner.toy": [fn("banner", 1)],
        "app/banner_alt.toy": [fn("banner", 2), fn("_hidden", 4)],
        "app/broken.toy": [fn("fixed", 4)],
        "app/greet.toy": [fn("greet", 1)],
        "app/main.toy": [],
        "lib/strings.toy": [fn("shout", 1), fn("whisper", 2)],
        "lib/strings_test.toy": [],
        "setup.toy": [],
        "tests/check.toy": [],
    },
    kinds: {
        "app/banner.toy": {},
        "app/banner_alt.toy": {},
        "app/broken.toy": { "use:app/greet": "internal", "use:missing/thing": "internal" },
        "app/greet.toy": { "name:banner": "internal" },
        "app/main.toy": { "use:app/greet": "internal", "use:strings": "internal", "name:banner": "internal" },
        "lib/strings.toy": { "use:lib/strings": "internal" },
        "lib/strings_test.toy": { "use:strings": "internal", "name:shout": "internal" },
        "setup.toy": { "use:app/main": "internal" },
        "tests/check.toy": { "use:app/main": "internal", "use:deps/vendored": "internal", "name:nothing": "internal" },
    },
    edges: EDGES,
    entryPoints: [{ path: "app/main.toy", declaredBy: "toy main" }],
    broken: { path: "app/broken.toy", specifiers: ["use:app/greet", "use:missing/thing"] },
    // the scan reading reads only `use` lines: the files with a `name` line differ, deliberately
    scan: {
        "app/greet.toy": [],
        "app/main.toy": ["use:app/greet", "use:strings"],
        "lib/strings_test.toy": ["use:strings"],
        "tests/check.toy": ["use:app/main", "use:deps/vendored"],
    },
    chunks: {
        "app/banner_alt.toy": [
            { kind: "function", name: "banner", startLine: 2, endLine: 2 },
            { kind: "function", name: "_hidden", startLine: 4, endLine: 4 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 4 },
        ],
        "app/main.toy": [{ kind: "file-summary", name: "(file)", startLine: 1, endLine: 5 }],
        "lib/strings.toy": [
            { kind: "function", name: "shout", startLine: 1, endLine: 1 },
            { kind: "function", name: "whisper", startLine: 2, endLine: 2 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 3 },
        ],
    },
    edits: [
        {
            description: "app/banner_alt.toy stops defining banner (its declares change): app/main.toy and app/greet.toy, unchanged, lose their edges to it",
            writes: { "app/banner_alt.toy": "def _hidden\n" },
            edgesAfter: without(edge("app/greet.toy", "app/banner_alt.toy"), edge("app/main.toy", "app/banner_alt.toy")),
        },
        {
            description: "a new file app/extra.toy defines banner (the file set changes): both readers of name:banner gain an edge to it",
            writes: { "app/extra.toy": "def banner\n" },
            edgesAfter: [
                edge("app/broken.toy", "app/greet.toy"),
                edge("app/greet.toy", "app/banner.toy"),
                edge("app/greet.toy", "app/banner_alt.toy"),
                edge("app/greet.toy", "app/extra.toy"),
                edge("app/main.toy", "app/banner.toy"),
                edge("app/main.toy", "app/banner_alt.toy"),
                edge("app/main.toy", "app/extra.toy"),
                edge("app/main.toy", "app/greet.toy"),
                edge("app/main.toy", "lib/strings.toy"),
                edge("lib/strings_test.toy", "lib/strings.toy"),
                edge("setup.toy", "app/main.toy"),
                edge("tests/check.toy", "app/main.toy"),
            ],
        },
        {
            // root app/: use:strings tries strings.toy, then app/strings.toy, neither indexed. lib/strings_test.toy keeps its
            // edge through name:shout, a file of its own folder.
            description: "toy.json's root moves from lib to app (a manifest changes): app/main.toy's use:strings names nothing now",
            writes: { "toy.json": "{ \"root\": \"app\" }\n" },
            edgesAfter: without(edge("app/main.toy", "lib/strings.toy")),
        },
        {
            // no toy.json: no root, and deps/ is no longer left out, so deps/vendored.toy is indexed and tests/check.toy's
            // use:deps/vendored names it
            description: "toy.json deleted (a manifest and the file set change): deps/vendored.toy enters the index",
            writes: { "toy.json": null },
            edgesAfter: [...without(edge("app/main.toy", "lib/strings.toy")), edge("tests/check.toy", "deps/vendored.toy")],
        },
    ],
};
