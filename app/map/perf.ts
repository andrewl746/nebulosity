/**
 * Interaction timings for S3 (PIVOT_SPEC.md §2: click, zoom or level change → rendered ≤ 100 ms). A start mark goes
 * down when the interaction begins, and the measure is taken after the frame that painted its result. Task 22 reads
 * them from window.__nebulosityPerf.
 */
type PerfWindow = Window & { __nebulosityPerf?: { name: string; ms: number }[] };

export function markStart(name: string): void {
    performance.clearMarks(`${name}:start`);
    performance.mark(`${name}:start`);
}

/**
 * Drops a start mark nothing will measure: a jump that ended without a new level (the editor's quiet jump to a path the
 * index doesn't hold, or a failed one). Left down, the next level drawn without a mark of its own (an index update's
 * redraw) would be timed from it, as one long change.
 */
export function clearStart(name: string): void {
    performance.clearMarks(`${name}:start`);
}

export function measureAfterPaint(name: string): void {
    // the first frame callback runs before the paint that shows the change; the second runs after it
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (performance.getEntriesByName(`${name}:start`, "mark").length === 0) return;
        const measure = performance.measure(name, `${name}:start`);
        performance.clearMarks(`${name}:start`);
        const w = window as PerfWindow;
        (w.__nebulosityPerf ??= []).push({ name, ms: Math.round(measure.duration * 10) / 10 });
    }));
}
