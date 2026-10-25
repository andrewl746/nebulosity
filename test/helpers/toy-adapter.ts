import type { LanguageRules } from "../../lib/index/languages/adapter";
import { dirOf } from "../../lib/index/paths";

/**
 * The toy language: a test language for the seam's shared code (Task F of the E4 plan), so discovery, the pipeline,
 * the incremental update and the conformance kit are tested without any real language.
 * - extension .toy; a test file ends _test.toy;
 * - manifests: toy.json (anywhere) and setup.toy, which is a code file too, as setup.py will be;
 * - a toy.json leaves out every .toy file under the deps/ folder beside it.
 */
export const toyRules: LanguageRules = {
    id: "toy",
    extensions: [".toy"],
    languageOf: () => "toy",
    isTest: (path) => /_test\.toy$/.test(path),
    manifest: /(^|\/)(toy\.json|setup\.toy)$/,
    excluded(manifests){
        const deps = manifests.filter((m) => /(^|\/)toy\.json$/.test(m)).map((m) => (dirOf(m) === "" ? "deps/" : `${dirOf(m)}/deps/`));
        return (path) => deps.some((prefix) => path.startsWith(prefix));
    },
};
