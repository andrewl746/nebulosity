/** A box pulses at most once per this long, however many tool calls touch it (PIVOT_SPEC.md §7: throttled). */
export const PULSE_GAP_MS = 800;

export type Pulse = { key: number; at: number };

/**
 * The pulse state after tool calls touched `boxes` at `now`. A box that hasn't pulsed in the last PULSE_GAP_MS gets a
 * new key, which remounts its pulse ring and plays it again; the others keep theirs.
 */
export function nextPulses(state: ReadonlyMap<string, Pulse>, boxes: readonly string[], now: number): Map<string, Pulse> {
    const next = new Map(state);
    for (const box of new Set(boxes)){
        const last = next.get(box);
        if (last && now - last.at < PULSE_GAP_MS) continue;
        next.set(box, { key: (last?.key ?? 0) + 1, at: now });
    }
    return next;
}
