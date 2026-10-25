import type { LanguageRules } from "../adapter";

/** A stub (Task F of the E4 plan): it claims no extension until this language's task fills it in. */
export const goRules: LanguageRules = {
    id: "go",
    extensions: [],
    languageOf: () => "go",
    isTest: () => false,
    manifest: /(?!)/,
    excluded: () => () => false,
};
