import type { LanguageRules } from "../adapter";
import { dirOf } from "../../paths";
import { withoutArity } from "./arity";

/** A test project's folder: Shop.Core.Tests, Api.Test, Web.UnitTests, Web.IntegrationTests, Web.FunctionalTests. */
const TEST_FOLDER = /\.(Tests?|UnitTests|IntegrationTests|FunctionalTests)$/;
/** A test file by its name: OrderTests.cs, OrderTest.cs (case-sensitive, so Latest.cs and Contest.cs are not tests). */
const TEST_FILE = /Tests?\.cs$/;

/** A project file anywhere, or an MSBuild Directory.Build.props: what C# resolution reads (project-wide Using items). */
export const CSHARP_MANIFEST = /(\.csproj|(^|\/)Directory\.Build\.props)$/;

/** The project files among the manifests: each one's folder is a project. */
export function projectFiles(manifests: readonly string[]): string[] {
    return manifests.filter((m) => m.endsWith(".csproj"));
}

/** An alias's statement from its body `X=A.B`, or null for a body that isn't one. */
function aliasText(keywords: string, body: string): string | null {
    const equals = body.indexOf("=");
    return equals === -1 ? null : `${keywords} ${body.slice(0, equals)} = ${body.slice(equals + 1)}`;
}

/** Each specifier class's statement or name as written (B-I3). A Map, so a class like "constructor" finds nothing. */
const CSHARP_FORMS: ReadonlyMap<string, (body: string) => string | null> = new Map([
    ["using", (body: string) => `using ${body}`],
    ["global", (body: string) => `global using ${body}`],
    ["static", (body: string) => `using static ${body}`],
    ["gstatic", (body: string) => `global using static ${body}`],
    ["alias", (body: string) => aliasText("using", body)],
    ["galias", (body: string) => aliasText("global using", body)],
    ["ns", (body: string) => `namespace ${body}`],
    ["type", (body: string) => body],
    ["qtype", (body: string) => body],
]);

/**
 * A specifier as the source writes it, for answers (B-I3): `using:A.B` is `using A.B`, `galias:X=A.B` is
 * `global using X = A.B`, `ns:A.B` is `namespace A.B`, and `type:N` and `qtype:A.B.N` are the code's `N` and `A.B.N`.
 * A generic name shows without its arity, as the code writes it without its type arguments: `type:Box`1` is `Box`.
 */
export function displayCsharpSpecifier(specifier: string): string {
    const colon = specifier.indexOf(":");
    const form = colon === -1 ? undefined : CSHARP_FORMS.get(specifier.slice(0, colon));
    return form?.(withoutArity(specifier.slice(colon + 1))) ?? specifier;
}

/**
 * C#'s pure rules (ADR-065, the E4 plan's Task C). A project's build output lives in bin/ and obj/ beside its .csproj
 * (obj/ holds generated .cs files, such as the SDK's GlobalUsings.g.cs), so those two folders are left out; a bin/ with
 * no .csproj beside it (a repo's own tools/bin/) stays.
 */
export const csharpRules: LanguageRules = {
    id: "csharp",
    extensions: [".cs"],
    languageOf: () => "csharp",
    isTest(path){
        const segments = path.split("/");
        const base = segments.pop() ?? "";
        return segments.some((segment) => TEST_FOLDER.test(segment)) || TEST_FILE.test(base);
    },
    manifest: CSHARP_MANIFEST,
    excluded(manifests){
        const prefixes = projectFiles(manifests).flatMap((m) => {
            const folder = dirOf(m);
            return folder === "" ? ["bin/", "obj/"] : [`${folder}/bin/`, `${folder}/obj/`];
        });
        return (path) => prefixes.some((prefix) => path.startsWith(prefix));
    },
    displaySpecifier: displayCsharpSpecifier,
};
