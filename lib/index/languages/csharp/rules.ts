import type { LanguageRules } from "../adapter";

/** A stub (Task F of the E4 plan): it claims no extension until this language's task fills it in. */
export const csharpRules: LanguageRules = {
    id: "csharp",
    extensions: [],
    languageOf: () => "csharp",
    isTest: () => false,
    manifest: /(?!)/,
    excluded: () => () => false,
};
