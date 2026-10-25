import type { LanguageRules } from "../adapter";

/** A stub (Task F of the E4 plan): it claims no extension until this language's task fills it in. */
export const javaRules: LanguageRules = {
    id: "java",
    extensions: [],
    languageOf: () => "java",
    isTest: () => false,
    manifest: /(?!)/,
    excluded: () => () => false,
};
