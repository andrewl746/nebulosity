import { dirOf } from "../../paths";
import type { LanguageRules } from "../adapter";

/** A test file by its name (the E4 design §6.5): JUnit's and Maven's conventions. The folder rule covers src/test/. */
const TEST_NAME = /(Test|Tests|IT|TestCase)\.java$/;

const POM = /(^|\/)pom\.xml$/;
const GRADLE_BUILD = /(^|\/)build\.gradle(\.kts)?$/;
const GRADLE_SETTINGS = /(^|\/)settings\.gradle(\.kts)?$/;

/** The folder a manifest sits in, as a prefix ("" at the repo root, else "<folder>/"). */
function besideOf(manifest: string): string {
    const dir = dirOf(manifest);
    return dir === "" ? "" : `${dir}/`;
}

/**
 * A specifier as the source writes it, for answers (B-I3): `import:a.b.C` is `import a.b.C`, `static:a.b.C` is
 * `import static a.b.C` (the specifier keeps the class, not the member), and `type:C` and `qualified:a.b.C` are the
 * code's `C` and `a.b.C`.
 */
export function displayJavaSpecifier(specifier: string): string {
    if (specifier.startsWith("import:")) return `import ${specifier.slice("import:".length)}`;
    if (specifier.startsWith("static:")) return `import static ${specifier.slice("static:".length)}`;
    if (specifier.startsWith("type:")) return specifier.slice("type:".length);
    if (specifier.startsWith("qualified:")) return specifier.slice("qualified:".length);
    return specifier;
}

/**
 * Java's pure rules (ADR-065, the E4 plan's Task J). Maven builds into target/ beside its pom.xml and Gradle into build/
 * beside its build script, with its caches in .gradle/: generated or copied sources there are build output, never the
 * repo's own code, so they're left out in both discovery modes (a git checkout may track them, a walk doesn't skip them).
 */
export const javaRules: LanguageRules = {
    id: "java",
    extensions: [".java"],
    languageOf: () => "java",
    isTest: (path) => TEST_NAME.test(path.slice(path.lastIndexOf("/") + 1)),
    manifest: /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/,
    excluded(manifests){
        const prefixes: string[] = [];
        for (const manifest of manifests){
            const beside = besideOf(manifest);
            if (POM.test(manifest)) prefixes.push(`${beside}target/`);
            if (GRADLE_BUILD.test(manifest)) prefixes.push(`${beside}build/`, `${beside}.gradle/`);
            if (GRADLE_SETTINGS.test(manifest)) prefixes.push(`${beside}.gradle/`);
        }
        const unique = [...new Set(prefixes)];
        return (path) => unique.some((prefix) => path.startsWith(prefix));
    },
    displaySpecifier: displayJavaSpecifier,
};
