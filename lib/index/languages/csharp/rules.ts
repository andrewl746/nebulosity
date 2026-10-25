import type { LanguageRules } from "../adapter";
import { dirOf } from "../../paths";

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
};
