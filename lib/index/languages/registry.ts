import type { LanguageAdapter } from "./adapter";
import { csharpAdapter } from "./csharp";
import { goAdapter } from "./go";
import { javaAdapter } from "./java";
import { pythonAdapter } from "./python";
import { rulesFor } from "./rules";
import { rustAdapter } from "./rust";
import { loadGrammars } from "./treesitter";
import { typescriptAdapter } from "./typescript-adapter";

/**
 * Every language adapter, in the order of RULES (rules.ts), each built on that entry's own rules (ADR-065). The full run
 * and the incremental update read this; discovery, the watcher and the engine read only the rules.
 */
export const ADAPTERS: readonly LanguageAdapter[] = [typescriptAdapter, pythonAdapter, goAdapter, javaAdapter, csharpAdapter, rustAdapter];

/** The adapter claiming a path (the longest claimed extension it ends with), or null. */
export function adapterFor(path: string, adapters: readonly LanguageAdapter[] = ADAPTERS): LanguageAdapter | null {
    return rulesFor(path, adapters);
}

export function adapterById(id: string, adapters: readonly LanguageAdapter[] = ADAPTERS): LanguageAdapter | null {
    return adapters.find((a) => a.id === id) ?? null;
}

/**
 * Loads the grammar of every adapter that has one (the stubs' too), once per process: about 50 ms for all five. Await it
 * before indexRepository or applyFileChanges in any process that indexes (the CLI's index command, the background
 * worker); a run that meets a file whose grammar isn't loaded throws GrammarNotLoadedError rather than index nothing.
 */
export async function prepareLanguages(adapters: readonly LanguageAdapter[] = ADAPTERS): Promise<void> {
    await loadGrammars(adapters.flatMap((a) => (a.grammar === null ? [] : [{ id: a.id, grammar: a.grammar }])));
}
