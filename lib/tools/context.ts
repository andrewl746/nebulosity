/**
 * What a tool handler knows about its call (ADR-046, ADR-047): the repo it answers about, whether summaries can be
 * written (free mode, ADR-043), and the notes the answer must carry.
 */
export type ToolContext = {
    /** The repo's root as stored (repositories.rootPath): absolute, forward slashes. */
    repoRoot: string;
    /** The stored summaries stage is "off": no API key, so missing summaries say what a key adds. */
    summariesOff: boolean;
    /** The answer's first line when the project folder didn't pick the repo. */
    repoNote?: string;
    /** Said after the answer while the structure stage isn't ready (PIVOT_SPEC.md §5.6, honest answers). */
    indexNote?: string;
};
