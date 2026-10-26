import type { SymbolKind, SymbolRow } from "../../lib/db/schema";
import type { FixtureTruth, TruthEdge } from "./fixture-truth";

/**
 * test/fixtures/java-repo's ground truth, DERIVED BY HAND from the fixture's files and the Java rules of the E4 plan
 * (docs/plans/2026-10-24-e4-languages.md, Task J) before any Java adapter code existed: never by running the code
 * (CLAUDE.md). Change a fixture file and re-derive this by hand.
 *
 * The rules, as applied here:
 * - Specifiers, in source order, each once: `import a.b.C;` → import:a.b.C; `import a.b.*;` → import:a.b.*; `import static
 *   a.b.C.m;` and `import static a.b.C.*;` → static:a.b.C (the class). type:C for each simple type name used (a type
 *   identifier in a type, generic arguments and bounds, extends and implements included; `new C(…)`; an annotation;
 *   `C.class`; `C::m`; the object of a method call or field access when it's an identifier starting upper-case that
 *   isn't a local, parameter or field of the file), leaving out names a single-type import names, names the file
 *   declares (its types at any depth) and type parameters. qualified:a.b.C for a fully qualified type name in code: a
 *   dotted name whose first segment starts lower-case, cut after its first segment starting upper-case (in a type, as
 *   `com.example.lib.Formatter`, and in an expression, as `com.example.lib.Strings.shout(…)`).
 * - Declares, sorted: package:<a.b> (package: for the default package), type:<a.b.C> per top-level type, and
 *   main:<a.b.C> per top-level type declaring `public static void main(String[] …)` or `(String… …)`.
 * - import:, static:, qualified: resolve to the files declaring type:<name>; when none does, the last segment is
 *   dropped until the rest names a declared type (a nested type's import reaches its outer type's file). import:a.b.*
 *   makes no edge. type:C tries the importer's package p.C, then its on-demand imports w.C; the first level with a hit
 *   wins. A name several files declare goes to the one under the importer's source root (its folder minus its package
 *   path), else to the one sharing the most leading folder segments with the importer; a tie resolves to nothing.
 * - Kinds: import:/static:/qualified: are internal when their package (the name minus its last segment, then minus
 *   segments while it names a declared type) is some file's package:, else external; import:a.b.* is context; type:C is
 *   internal when some indexed file declares a top-level type named C, else external (java.lang's String, System,
 *   Override… are external).
 * - Symbols: top-level types (class and record → class; interface and annotation type → interface; enum → enum) and
 *   one level of their members (methods and annotation elements → method; constructors → constructor, named as written;
 *   fields, interface constants and enum constants → property; nested types → their kind, but not their own members).
 *   Lines run from the declaration's first line (its annotations included) to its last, comments left out. Exported:
 *   the `public` modifier; members of a public interface or annotation type, and constants of a public enum, are
 *   exported (implicitly public). Record components aren't listed (they aren't body declarations).
 * - Chunks: one per top-level type (class, interface, enum), its span reaching up over an attached comment, then the
 *   file summary.
 * - Test files: a src/test/ (test/) folder, or a name ending Test, Tests, IT or TestCase before .java.
 * - Left out: files under target/ beside a pom.xml, and under build/ or .gradle/ beside a build.gradle(.kts).
 * - Entry points: each file declaring a main:, by "public static void main".
 */

/** A symbol: a top-level type when `parent` is null, else a member of that top-level type. */
const sym = (name: string, kind: SymbolKind, startLine: number, endLine: number, exported: boolean, parent: string | null = null): SymbolRow => ({
    name, qualifiedName: parent === null ? name : `${parent}.${name}`, kind, startLine, endLine, exported, parentQualifiedName: parent,
});
const edge = (source: string, target: string): TruthEdge => ({ source, target });
const byEdge = (a: TruthEdge, b: TruthEdge): number =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);

const A = "app/src/main/java/com/example/app/";
const AT = "app/src/test/java/com/example/";
const L = "lib/src/main/java/com/example/lib/";
const LT = "lib/src/test/java/com/example/";
const T = "tools/src/main/java/";

const APP = `${A}App.java`;
const BROKEN = `${A}Broken.java`;
const CONFIG = `${A}Config.java`;
const MODE = `${A}Mode.java`;
const REGISTRY = `${A}Registry.java`;
const SERVICE = `${A}Service.java`;
const APP_SAMPLE = `${AT}Sample.java`;
const SAMPLE_TEST = `${AT}SampleTest.java`;
const APP_IT = `${AT}app/AppIT.java`;
const AUDITED = `${L}Audited.java`;
const CONSTANTS = `${L}Constants.java`;
const FORMATTER = `${L}Formatter.java`;
const GREETER = `${L}Greeter.java`;
const OUTER = `${L}Outer.java`;
const STRINGS = `${L}Strings.java`;
const WIDGET = `${L}Widget.java`;
const PACKAGE_INFO = `${L}package-info.java`;
const LIB_SAMPLE = `${LT}Sample.java`;
const STRINGS_TEST = `${LT}lib/StringsTest.java`;
const LAUNCHER = `${T}Launcher.java`;
const CHECK = `${T}com/example/tools/Check.java`;
const TOOLS_TEST_CASE = `${T}com/example/tools/ToolsTestCase.java`;
/** Left out while app/pom.xml exists (target/ beside it); indexed once edit 3 deletes the pom. */
const SERVICE_FACTORY = "app/target/generated-sources/annotations/com/example/app/ServiceFactory.java";
/** Left out: .gradle/ beside tools/build.gradle.kts. */
const STALE = "tools/.gradle/8.10/Stale.java";
/** Added by edit 4. */
const APP_WIDGET = `${A}Widget.java`;

/** The 32 edges of a full run, sorted by source then target, each with the specifier and rule that makes it. */
const EDGES: TruthEdge[] = [
    edge(APP, MODE),                       // type:Mode (Mode.FAST, line 26): the importer's package, com.example.app.Mode
    edge(APP, SERVICE),                    // type:Service (line 26): the importer's package
    edge(APP, CONSTANTS),                  // static:com.example.lib.Constants (import static …Constants.*)
    edge(APP, GREETER),                    // import:com.example.lib.Greeter
    edge(APP, OUTER),                      // import:com.example.lib.Outer.Inner: not declared, so dropped to …Outer
    edge(APP, STRINGS),                    // static:com.example.lib.Strings (import static …Strings.shout)
    edge(APP, WIDGET),                     // type:Widget: no com.example.app.Widget, so the on-demand import com.example.lib.*
    edge(BROKEN, CONFIG),                  // type:Config (line 11, after the error): the importer's package
    edge(BROKEN, GREETER),                 // import:com.example.lib.Greeter (above the error)
    edge(REGISTRY, CONFIG),                // type:Config (Config.defaults()): the importer's package
    edge(REGISTRY, MODE),                  // type:Mode (Mode.FAST): the importer's package
    edge(REGISTRY, AUDITED),               // type:Audited (the annotation @Audited): on-demand com.example.lib.*
    edge(REGISTRY, CONSTANTS),             // type:Constants (Constants.class): on-demand
    edge(REGISTRY, FORMATTER),             // type:Formatter (new Formatter()): on-demand
    edge(REGISTRY, GREETER),               // type:Greeter (implements): on-demand
    edge(REGISTRY, OUTER),                 // type:Outer (extends): on-demand
    edge(REGISTRY, STRINGS),               // type:Strings (Strings::shout): on-demand
    edge(REGISTRY, WIDGET),                // type:Widget (the bound of T): on-demand
    edge(SERVICE, MODE),                   // type:Mode (a field's type): the importer's package
    edge(SERVICE, FORMATTER),              // qualified:com.example.lib.Formatter (in a type, line 10)
    edge(SERVICE, GREETER),                // import:com.example.lib.Greeter
    edge(SERVICE, STRINGS),                // qualified:com.example.lib.Strings (in an expression, line 18)
    edge(SAMPLE_TEST, APP_SAMPLE),         // type:Sample: com.example.Sample has two declarers; the one under app/src/test/java
    edge(APP_IT, APP),                     // type:App (App.main(…)): the importer's package (main and test share it)
    edge(APP_IT, MODE),                    // type:Mode (Mode.FAST.quick()): the importer's package
    edge(FORMATTER, WIDGET),               // type:Widget (a parameter's type): the importer's package
    edge(PACKAGE_INFO, AUDITED),           // type:Audited (the package's annotation): the importer's package
    edge(STRINGS_TEST, STRINGS),           // static:com.example.lib.Strings
    edge(STRINGS_TEST, LIB_SAMPLE),        // import:com.example.Sample: two declarers; the one under lib/src/test/java
    edge(LAUNCHER, CHECK),                 // import:com.example.tools.Check (from the default package)
    edge(CHECK, STRINGS),                  // import:com.example.lib.Strings
    edge(TOOLS_TEST_CASE, CHECK),          // type:Check (a return type): the importer's package
    // not edges: every import:a.b.* (context); every external (java.*, org.junit.*, java.lang's String, System…);
    // tools' Check's import:com.example.Sample (two declarers, neither under tools/src/main/java, each sharing no
    // leading folder with tools/src/main/java/com/example/tools: a tie)
];

const without = (edges: readonly TruthEdge[], ...dropped: TruthEdge[]): TruthEdge[] =>
    edges.filter((e) => !dropped.some((d) => d.source === e.source && d.target === e.target));
const sorted = (edges: TruthEdge[]): TruthEdge[] => [...edges].sort(byEdge);

const APP_POM = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">",
    "  <modelVersion>4.0.0</modelVersion>",
    "  <parent>",
    "    <groupId>com.example</groupId>",
    "    <artifactId>java-repo</artifactId>",
    "    <version>1.0.0</version>",
    "  </parent>",
    "  <artifactId>app</artifactId>",
    "  <description>The app module, described.</description>",
    "  <dependencies>",
    "    <dependency>",
    "      <groupId>com.example</groupId>",
    "      <artifactId>lib</artifactId>",
    "      <version>1.0.0</version>",
    "    </dependency>",
    "  </dependencies>",
    "</project>",
    "",
].join("\n");

export const javaRepoTruth: FixtureTruth = {
    files: [
        { path: APP, language: "java", isTest: false, lineCount: 29 },
        { path: BROKEN, language: "java", isTest: false, lineCount: 13 },
        { path: CONFIG, language: "java", isTest: false, lineCount: 9 },
        { path: MODE, language: "java", isTest: false, lineCount: 16 },
        { path: REGISTRY, language: "java", isTest: false, lineCount: 24 },
        { path: SERVICE, language: "java", isTest: false, lineCount: 20 },
        { path: APP_SAMPLE, language: "java", isTest: true, lineCount: 9 },           // src/test/ (the folder rule)
        { path: SAMPLE_TEST, language: "java", isTest: true, lineCount: 13 },         // the folder and the name (…Test)
        { path: APP_IT, language: "java", isTest: true, lineCount: 14 },              // the folder and the name (…IT)
        { path: AUDITED, language: "java", isTest: false, lineCount: 17 },
        { path: CONSTANTS, language: "java", isTest: false, lineCount: 11 },
        { path: FORMATTER, language: "java", isTest: false, lineCount: 8 },
        { path: GREETER, language: "java", isTest: false, lineCount: 13 },
        { path: OUTER, language: "java", isTest: false, lineCount: 30 },
        { path: STRINGS, language: "java", isTest: false, lineCount: 17 },
        { path: WIDGET, language: "java", isTest: false, lineCount: 19 },
        { path: PACKAGE_INFO, language: "java", isTest: false, lineCount: 5 },
        { path: LIB_SAMPLE, language: "java", isTest: true, lineCount: 9 },           // src/test/
        { path: STRINGS_TEST, language: "java", isTest: true, lineCount: 15 },        // the folder and the name (…Test)
        { path: LAUNCHER, language: "java", isTest: false, lineCount: 9 },
        { path: CHECK, language: "java", isTest: false, lineCount: 12 },
        { path: TOOLS_TEST_CASE, language: "java", isTest: true, lineCount: 7 },      // the name alone (…TestCase), in src/main/
    ],
    excluded: [SERVICE_FACTORY, STALE],
    specifiers: {
        [APP]: [
            "static:com.example.lib.Constants",
            "static:com.example.lib.Strings",
            "import:com.example.lib.*",
            "import:com.example.lib.Greeter",
            "import:com.example.lib.Outer.Inner",
            "import:java.util.List",
            "type:String",      // line 20 (Greeter, List and Inner are single-type imports; App is the file's own)
            "type:Widget",      // line 20, List<Widget>
            "type:Service",     // line 26
            "type:Mode",        // line 26, Mode.FAST
            "type:System",      // line 27, System.out
        ],
        [BROKEN]: ["import:com.example.lib.Greeter", "type:Config"],
        [CONFIG]: ["type:String"],
        [MODE]: ["type:String"],    // line 15; FAST on line 9 is an identifier, not an object
        [REGISTRY]: [
            "import:com.example.lib.*",
            "import:java.util.ArrayList",
            "import:java.util.List",
            "import:java.util.function.Function",
            "type:Audited",     // line 9, the annotation
            "type:Widget",      // line 10, the bound of the type parameter T (T itself left out)
            "type:Outer",       // line 10, extends
            "type:Greeter",     // line 10, implements
            "type:Object",      // line 16
            "type:Formatter",   // line 17, new Formatter()
            "type:String",      // line 20
            "type:Strings",     // line 21, Strings::shout
            "type:Constants",   // line 22, Constants.class
            "type:Config",      // line 22, Config.defaults()
            "type:Mode",        // line 22, Mode.FAST (ALL.size(): ALL is a field of the file)
        ],
        [SERVICE]: [
            "import:com.example.lib.Greeter",
            "type:Mode",                            // line 8
            "qualified:com.example.lib.Formatter",  // line 10, a field's type and new (once)
            "type:Override",                        // line 16
            "type:String",                          // line 17
            "qualified:com.example.lib.Strings",    // line 18, com.example.lib.Strings.shout(name); PREFIX isn't an object
        ],
        [APP_SAMPLE]: ["type:String"],
        [SAMPLE_TEST]: ["import:org.junit.jupiter.api.Test", "type:Sample", "type:AssertionError"],
        [APP_IT]: ["static:org.junit.jupiter.api.Assertions", "import:org.junit.jupiter.api.Test", "type:Mode", "type:App", "type:String"],
        [AUDITED]: [
            "import:java.lang.annotation.ElementType",
            "import:java.lang.annotation.Retention",
            "import:java.lang.annotation.RetentionPolicy",
            "import:java.lang.annotation.Target",
            "type:String",      // line 14 (the annotations and RetentionPolicy, ElementType are single-type imports)
        ],
        [CONSTANTS]: ["type:String"],
        [FORMATTER]: ["type:String", "type:Widget"],
        [GREETER]: ["type:String"],     // Greeter (line 10) is the file's own
        [OUTER]: ["import:java.util.ArrayList", "import:java.util.List", "type:String"],    // Inner and Kind are the file's own
        [STRINGS]: ["import:java.util.Locale", "type:String"],
        [WIDGET]: ["type:Comparable", "type:String", "type:Override"],
        [PACKAGE_INFO]: ["type:Audited"],
        [LIB_SAMPLE]: ["type:String"],
        [STRINGS_TEST]: [
            "static:com.example.lib.Strings",
            "static:org.junit.jupiter.api.Assertions",
            "import:com.example.Sample",
            "import:org.junit.jupiter.api.Test",
        ],
        [LAUNCHER]: ["import:com.example.tools.Check", "type:String", "type:System"],
        [CHECK]: ["import:com.example.Sample", "import:com.example.lib.Strings", "type:String"],
        [TOOLS_TEST_CASE]: ["type:Check"],
    },
    declares: {
        [APP]: ["main:com.example.app.App", "package:com.example.app", "type:com.example.app.App"],
        [BROKEN]: ["package:com.example.app", "type:com.example.app.Broken"],
        [CONFIG]: ["package:com.example.app", "type:com.example.app.Config"],
        [MODE]: ["package:com.example.app", "type:com.example.app.Mode", "type:com.example.app.ModeNames"],
        [REGISTRY]: ["package:com.example.app", "type:com.example.app.Registry"],
        [SERVICE]: ["package:com.example.app", "type:com.example.app.Service"],
        [APP_SAMPLE]: ["package:com.example", "type:com.example.Sample"],
        [SAMPLE_TEST]: ["package:com.example", "type:com.example.SampleTest"],
        [APP_IT]: ["package:com.example.app", "type:com.example.app.AppIT"],
        [AUDITED]: ["package:com.example.lib", "type:com.example.lib.Audited"],
        [CONSTANTS]: ["package:com.example.lib", "type:com.example.lib.Constants"],
        [FORMATTER]: ["package:com.example.lib", "type:com.example.lib.Formatter"],
        [GREETER]: ["package:com.example.lib", "type:com.example.lib.Greeter"],
        [OUTER]: ["package:com.example.lib", "type:com.example.lib.Outer"],
        [STRINGS]: ["package:com.example.lib", "type:com.example.lib.Strings"],
        [WIDGET]: ["package:com.example.lib", "type:com.example.lib.Widget"],
        [PACKAGE_INFO]: ["package:com.example.lib"],
        [LIB_SAMPLE]: ["package:com.example", "type:com.example.Sample"],
        [STRINGS_TEST]: ["package:com.example.lib", "type:com.example.lib.StringsTest"],
        [LAUNCHER]: ["main:Launcher", "package:", "type:Launcher"],     // the default package; main(String... args)
        [CHECK]: ["package:com.example.tools", "type:com.example.tools.Check"],
        [TOOLS_TEST_CASE]: ["package:com.example.tools", "type:com.example.tools.ToolsTestCase"],
    },
    symbols: {
        [APP]: [
            sym("App", "class", 12, 29, true),
            sym("greeter", "property", 14, 14, false, "App"),
            sym("App", "constructor", 16, 18, true, "App"),
            sym("run", "method", 20, 23, true, "App"),
            sym("main", "method", 25, 28, true, "App"),
        ],
        [BROKEN]: [
            sym("Broken", "class", 5, 13, true),
            sym("before", "method", 7, 9, false, "Broken"),
            sym("after", "method", 11, 12, false, "Broken"),
        ],
        [CONFIG]: [
            sym("Config", "class", 4, 9, true),     // a record; its components host and port aren't listed
            sym("defaults", "method", 6, 8, true, "Config"),
        ],
        [MODE]: [
            sym("Mode", "enum", 4, 11, true),
            sym("FAST", "property", 5, 5, true, "Mode"),     // a public enum's constants are public
            sym("SLOW", "property", 6, 6, true, "Mode"),
            sym("quick", "method", 8, 10, true, "Mode"),
            sym("ModeNames", "class", 13, 16, false),
            sym("FAST_NAME", "property", 15, 15, false, "ModeNames"),
        ],
        [REGISTRY]: [
            sym("Registry", "class", 9, 24, true),          // from its annotation on line 9
            sym("ALL", "property", 12, 12, false, "Registry"),
            sym("items", "property", 14, 14, false, "Registry"),
            sym("formatter", "method", 16, 18, true, "Registry"),
            sym("greet", "method", 20, 23, true, "Registry"),
        ],
        [SERVICE]: [
            sym("Service", "class", 6, 20, true),
            sym("mode", "property", 8, 8, false, "Service"),
            sym("formatter", "property", 10, 10, false, "Service"),
            sym("Service", "constructor", 12, 14, true, "Service"),
            sym("greet", "method", 16, 19, true, "Service"),     // from @Override on line 16
        ],
        [APP_SAMPLE]: [
            sym("Sample", "class", 4, 9, true),
            sym("name", "method", 6, 8, true, "Sample"),
        ],
        [SAMPLE_TEST]: [
            sym("SampleTest", "class", 5, 13, false),
            sym("namesTheModule", "method", 7, 12, false, "SampleTest"),
        ],
        [APP_IT]: [
            sym("AppIT", "class", 7, 14, false),
            sym("runsInFastMode", "method", 9, 13, false, "AppIT"),
        ],
        [AUDITED]: [
            sym("Audited", "interface", 9, 17, true),       // an annotation type, from @Retention on line 9
            sym("value", "method", 14, 14, true, "Audited"),
            sym("level", "method", 16, 16, true, "Audited"),
        ],
        [CONSTANTS]: [
            sym("Constants", "class", 3, 11, true),
            sym("MAX_NAME", "property", 5, 5, true, "Constants"),
            sym("DEFAULT_NAME", "property", 7, 7, true, "Constants"),
            sym("Constants", "constructor", 9, 10, false, "Constants"),
        ],
        [FORMATTER]: [
            sym("Formatter", "class", 3, 8, true),
            sym("format", "method", 5, 7, true, "Formatter"),
        ],
        [GREETER]: [
            sym("Greeter", "interface", 4, 13, true),
            sym("PREFIX", "property", 6, 6, true, "Greeter"),    // a public interface's members are public
            sym("greet", "method", 8, 8, true, "Greeter"),
            sym("twice", "method", 10, 12, true, "Greeter"),
        ],
        [OUTER]: [
            sym("Outer", "class", 7, 30, true),
            sym("parts", "property", 9, 9, false, "Outer"),
            sym("add", "method", 11, 13, true, "Outer"),
            sym("Inner", "class", 16, 27, true, "Outer"),      // a nested type: listed, its own members not
            sym("Kind", "enum", 29, 29, false, "Outer"),
        ],
        [STRINGS]: [
            sym("Strings", "class", 5, 17, true),
            sym("Strings", "constructor", 7, 8, false, "Strings"),
            sym("shout", "method", 10, 12, true, "Strings"),
            sym("whisper", "method", 14, 16, false, "Strings"),
        ],
        [WIDGET]: [
            sym("Widget", "class", 3, 19, true),
            sym("name", "property", 5, 5, false, "Widget"),
            sym("Widget", "constructor", 7, 9, true, "Widget"),
            sym("of", "method", 11, 13, true, "Widget"),
            sym("compareTo", "method", 15, 18, true, "Widget"),
        ],
        [PACKAGE_INFO]: [],
        [LIB_SAMPLE]: [
            sym("Sample", "class", 4, 9, true),
            sym("name", "method", 6, 8, true, "Sample"),
        ],
        [STRINGS_TEST]: [
            sym("StringsTest", "class", 9, 15, false),
            sym("shoutsTheSampleName", "method", 11, 14, false, "StringsTest"),
        ],
        [LAUNCHER]: [
            sym("Launcher", "class", 4, 9, true),
            sym("main", "method", 6, 8, true, "Launcher"),
        ],
        [CHECK]: [
            sym("Check", "class", 7, 12, true),
            sym("run", "method", 9, 11, true, "Check"),
        ],
        [TOOLS_TEST_CASE]: [
            sym("ToolsTestCase", "class", 4, 7, true),
            sym("check", "method", 6, 6, false, "ToolsTestCase"),    // protected, not public
        ],
    },
    kinds: {
        [APP]: {
            "static:com.example.lib.Constants": "internal",
            "static:com.example.lib.Strings": "internal",
            "import:com.example.lib.*": "context",
            "import:com.example.lib.Greeter": "internal",
            "import:com.example.lib.Outer.Inner": "internal",   // com.example.lib.Outer is a declared type: its package com.example.lib
            "import:java.util.List": "external",
            "type:String": "external",
            "type:Widget": "internal",
            "type:Service": "internal",
            "type:Mode": "internal",
            "type:System": "external",
        },
        [BROKEN]: { "import:com.example.lib.Greeter": "internal", "type:Config": "internal" },
        [CONFIG]: { "type:String": "external" },
        [MODE]: { "type:String": "external" },
        [REGISTRY]: {
            "import:com.example.lib.*": "context",
            "import:java.util.ArrayList": "external",
            "import:java.util.List": "external",
            "import:java.util.function.Function": "external",
            "type:Audited": "internal",
            "type:Widget": "internal",
            "type:Outer": "internal",
            "type:Greeter": "internal",
            "type:Object": "external",
            "type:Formatter": "internal",
            "type:String": "external",
            "type:Strings": "internal",
            "type:Constants": "internal",
            "type:Config": "internal",
            "type:Mode": "internal",
        },
        [SERVICE]: {
            "import:com.example.lib.Greeter": "internal",
            "type:Mode": "internal",
            "qualified:com.example.lib.Formatter": "internal",
            "type:Override": "external",
            "type:String": "external",
            "qualified:com.example.lib.Strings": "internal",
        },
        [APP_SAMPLE]: { "type:String": "external" },
        [SAMPLE_TEST]: { "import:org.junit.jupiter.api.Test": "external", "type:Sample": "internal", "type:AssertionError": "external" },
        [APP_IT]: {
            "static:org.junit.jupiter.api.Assertions": "external",
            "import:org.junit.jupiter.api.Test": "external",
            "type:Mode": "internal",
            "type:App": "internal",
            "type:String": "external",
        },
        [AUDITED]: {
            "import:java.lang.annotation.ElementType": "external",
            "import:java.lang.annotation.Retention": "external",
            "import:java.lang.annotation.RetentionPolicy": "external",
            "import:java.lang.annotation.Target": "external",
            "type:String": "external",
        },
        [CONSTANTS]: { "type:String": "external" },
        [FORMATTER]: { "type:String": "external", "type:Widget": "internal" },
        [GREETER]: { "type:String": "external" },
        [OUTER]: { "import:java.util.ArrayList": "external", "import:java.util.List": "external", "type:String": "external" },
        [STRINGS]: { "import:java.util.Locale": "external", "type:String": "external" },
        [WIDGET]: { "type:Comparable": "external", "type:String": "external", "type:Override": "external" },
        [PACKAGE_INFO]: { "type:Audited": "internal" },
        [LIB_SAMPLE]: { "type:String": "external" },
        [STRINGS_TEST]: {
            "static:com.example.lib.Strings": "internal",
            "static:org.junit.jupiter.api.Assertions": "external",
            "import:com.example.Sample": "internal",
            "import:org.junit.jupiter.api.Test": "external",
        },
        [LAUNCHER]: { "import:com.example.tools.Check": "internal", "type:String": "external", "type:System": "external" },
        // import:com.example.Sample is internal (com.example is a package here) though it resolves to nothing (a tie)
        [CHECK]: { "import:com.example.Sample": "internal", "import:com.example.lib.Strings": "internal", "type:String": "external" },
        [TOOLS_TEST_CASE]: { "type:Check": "internal" },
    },
    edges: EDGES,
    entryPoints: [
        { path: APP, declaredBy: "public static void main" },
        { path: LAUNCHER, declaredBy: "public static void main" },
    ],
    // `int count = ;` on line 8: the import above it and the type:Config on line 11 below it are both still read
    broken: { path: BROKEN, specifiers: ["import:com.example.lib.Greeter", "type:Config"] },
    // the scan reading reads only the package and import lines: every file with a type: or qualified: specifier differs,
    // deliberately (lib's StringsTest has only import lines, so it reads the same)
    scan: {
        [APP]: [
            "static:com.example.lib.Constants",
            "static:com.example.lib.Strings",
            "import:com.example.lib.*",
            "import:com.example.lib.Greeter",
            "import:com.example.lib.Outer.Inner",
            "import:java.util.List",
        ],
        [BROKEN]: ["import:com.example.lib.Greeter"],
        [CONFIG]: [],
        [MODE]: [],
        [REGISTRY]: ["import:com.example.lib.*", "import:java.util.ArrayList", "import:java.util.List", "import:java.util.function.Function"],
        [SERVICE]: ["import:com.example.lib.Greeter"],
        [APP_SAMPLE]: [],
        [SAMPLE_TEST]: ["import:org.junit.jupiter.api.Test"],
        [APP_IT]: ["static:org.junit.jupiter.api.Assertions", "import:org.junit.jupiter.api.Test"],
        [AUDITED]: [
            "import:java.lang.annotation.ElementType",
            "import:java.lang.annotation.Retention",
            "import:java.lang.annotation.RetentionPolicy",
            "import:java.lang.annotation.Target",
        ],
        [CONSTANTS]: [],
        [FORMATTER]: [],
        [GREETER]: [],
        [OUTER]: ["import:java.util.ArrayList", "import:java.util.List"],
        [STRINGS]: ["import:java.util.Locale"],
        [WIDGET]: [],
        [PACKAGE_INFO]: [],
        [LIB_SAMPLE]: [],
        [LAUNCHER]: ["import:com.example.tools.Check"],
        [CHECK]: ["import:com.example.Sample", "import:com.example.lib.Strings"],
        [TOOLS_TEST_CASE]: [],
    },
    chunks: {
        [APP]: [
            { kind: "class", name: "App", startLine: 11, endLine: 29 },     // with its doc comment on line 11
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 29 },
        ],
        [BROKEN]: [
            { kind: "class", name: "Broken", startLine: 5, endLine: 13 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 13 },
        ],
        [CONFIG]: [
            { kind: "class", name: "Config", startLine: 3, endLine: 9 },    // a record
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 9 },
        ],
        [MODE]: [
            { kind: "enum", name: "Mode", startLine: 3, endLine: 11 },
            { kind: "class", name: "ModeNames", startLine: 13, endLine: 16 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 16 },
        ],
        [REGISTRY]: [
            { kind: "class", name: "Registry", startLine: 8, endLine: 24 },   // the comment on 8, the annotation on 9
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 24 },
        ],
        [AUDITED]: [
            { kind: "interface", name: "Audited", startLine: 8, endLine: 17 },  // an annotation type
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 17 },
        ],
        [OUTER]: [
            { kind: "class", name: "Outer", startLine: 6, endLine: 30 },    // one chunk: Inner and Kind are inside it
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 30 },
        ],
        [STRINGS]: [
            { kind: "class", name: "Strings", startLine: 5, endLine: 17 },  // no comment above (line 4 is blank)
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 17 },
        ],
        [PACKAGE_INFO]: [{ kind: "file-summary", name: "(file)", startLine: 1, endLine: 5 }],
        [LAUNCHER]: [
            { kind: "class", name: "Launcher", startLine: 3, endLine: 9 },
            { kind: "file-summary", name: "(file)", startLine: 1, endLine: 9 },
        ],
    },
    edits: [
        {
            // lib's Formatter now declares com.example.lib.format.Formatter: Service's qualified:com.example.lib.Formatter
            // and Registry's type:Formatter (through com.example.lib.*) name nothing, and Formatter's own type:Widget looks
            // in com.example.lib.format, where nothing declares Widget
            description: "lib's Formatter.java moves to package com.example.lib.format (its declares change): Registry and Service, unchanged, lose their edges to it, and it loses its own to Widget",
            writes: {
                [FORMATTER]: [
                    "package com.example.lib.format;",
                    "",
                    "public class Formatter {",
                    "",
                    "    public String format(Widget widget) {",
                    "        return \"[\" + widget + \"]\";",
                    "    }",
                    "}",
                    "",
                ].join("\n"),
            },
            edgesAfter: without(EDGES, edge(FORMATTER, WIDGET), edge(REGISTRY, FORMATTER), edge(SERVICE, FORMATTER)),
        },
        {
            description: "app/pom.xml gains a description (a manifest changes): every edge stays",
            writes: { "app/pom.xml": APP_POM },
            edgesAfter: EDGES,
        },
        {
            // with no pom.xml beside it, app/target/ is no longer left out (the root pom.xml leaves out target/ only)
            description: "app/pom.xml deleted (a manifest and the file set change): app/target/'s ServiceFactory.java enters the index with its three edges",
            writes: { "app/pom.xml": null },
            edgesAfter: sorted([
                ...EDGES,
                edge(SERVICE_FACTORY, GREETER),    // import:com.example.lib.Greeter
                edge(SERVICE_FACTORY, SERVICE),    // type:Service (new Service(…)): the importer's package
                edge(SERVICE_FACTORY, MODE),       // type:Mode (Mode.SLOW): the importer's package
            ]),
        },
        {
            // Java's order: the importer's own package before its on-demand imports, so com.example.app.Widget shadows
            // com.example.lib.Widget for App and Registry (lib's Formatter, in com.example.lib, keeps lib's)
            description: "a new app/.../Widget.java in com.example.app (the file set changes): App's and Registry's type:Widget now resolve to it, not to lib's Widget",
            writes: {
                [APP_WIDGET]: [
                    "package com.example.app;",
                    "",
                    "/** The app's own widget: it shadows com.example.lib.Widget in this package. */",
                    "class Widget {",
                    "}",
                    "",
                ].join("\n"),
            },
            edgesAfter: sorted([
                ...without(EDGES, edge(APP, WIDGET), edge(REGISTRY, WIDGET)),
                edge(APP, APP_WIDGET),
                edge(REGISTRY, APP_WIDGET),
            ]),
        },
        {
            // com.example.Sample has one declarer left, so no source-root or folder rule is needed: app's SampleTest
            // and tools' Check both reach lib's (lib's StringsTest already did)
            description: "app's test Sample.java deleted (the file set changes): app's SampleTest and tools' Check, unchanged, now reach lib's Sample",
            writes: { [APP_SAMPLE]: null },
            edgesAfter: sorted([
                ...without(EDGES, edge(SAMPLE_TEST, APP_SAMPLE)),
                edge(SAMPLE_TEST, LIB_SAMPLE),
                edge(CHECK, LIB_SAMPLE),
            ]),
        },
    ],
};
