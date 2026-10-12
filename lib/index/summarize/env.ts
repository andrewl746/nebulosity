/** Summaries need ANTHROPIC_API_KEY. Without it the stage reports "off" and everything else still works (PIVOT_SPEC.md §5.3). */
export function summariesEnabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}
