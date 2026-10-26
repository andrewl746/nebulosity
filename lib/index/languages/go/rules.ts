import type { LanguageRules } from "../adapter";
import { dirOf } from "../../paths";

/** A go.mod anywhere: the root of a Go module (its `module` line names the import path of its folder). */
export const GO_MOD = /(^|\/)go\.mod$/;

/**
 * A specifier as the source writes it, for answers (B-I3): `import:x/y` is `import "x/y"`, `import:x/y as z` is
 * `import z "x/y"`, `use:api.Open` is the code's `api.Open`, and `name:Store` is the bare name `Store`.
 */
export function displayGoSpecifier(specifier: string): string {
    if (specifier.startsWith("import:")){
        const body = specifier.slice("import:".length);
        const as = body.lastIndexOf(" as ");
        return as === -1 ? `import "${body}"` : `import ${body.slice(as + " as ".length)} "${body.slice(0, as)}"`;
    }
    if (specifier.startsWith("use:")) return specifier.slice("use:".length);
    if (specifier.startsWith("name:")) return specifier.slice("name:".length);
    return specifier;
}

/**
 * Go's pure rules (Task G of the E4 plan, ADR-065): `.go` files; a test file's name ends `_test.go` (what `go test`
 * compiles); go.mod and go.work are the manifests; and the vendor/ folder beside each go.mod is left out, since
 * `go mod vendor` copies other modules' code there.
 */
export const goRules: LanguageRules = {
    id: "go",
    extensions: [".go"],
    languageOf: () => "go",
    // the basename ends _test.go; a path can only end with it if its last segment does
    isTest: (path) => path.endsWith("_test.go"),
    manifest: /(^|\/)go\.(mod|work)$/,
    excluded(manifests){
        const vendors = manifests.filter((m) => GO_MOD.test(m)).map((m) => (dirOf(m) === "" ? "vendor/" : `${dirOf(m)}/vendor/`));
        return (path) => vendors.some((prefix) => path.startsWith(prefix));
    },
    displaySpecifier: displayGoSpecifier,
};
