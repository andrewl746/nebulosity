/**
 * When a change of the active editor should move the Map (P16). Following is "the Map shows the file you're in", so the
 * gate keeps the path the Map is known to show, and lets a follow through only to a path it doesn't show already.
 * - What the Map shows comes from two sources: what the extension last asked for (a follow or a show), and what the Map
 *   says it drew (each `drawn`'s selected). For ASKED_MS after an ask, the ask wins. A `drawn` for an earlier follow can
 *   land after a newer one went out (switching A, B, A quickly), and if it counted, the switch back to A would be
 *   refused and the Map left on B (Task 8 Review M2). After that, the Map's own word rules again: it may have ignored
 *   the ask (a file the index doesn't hold), or moved since (Claude's focus).
 * - A file opened from the Map is an echo: VS Code reports it as an editor change, and following it back would undo
 *   whatever the Map did since (a pick on another box), so it's held off for ECHO_MS.
 */

/** How long the active editor has to stay put before the Map follows it: a burst of switches gives one follow. */
export const FOLLOW_DEBOUNCE_MS = 150;

/** How long a file opened from the Map is kept from being followed back. */
export const ECHO_MS = 2_000;

/**
 * How long a follow or show stands for what the Map shows, over its `drawn` reports. A draw of another folder takes well
 * under a second warm (Editor bench's E2 bar is 500 ms with the debounce), so 2 s leaves room for a cold one. A longer
 * ask costs only a refused follow to the very file just asked for.
 */
export const ASKED_MS = 2_000;

export class FollowGate {
    /** What the Map last said it shows, or was last asked for; null when that's unknown (after a reset). */
    private shown: string | null = null;
    /** The last path the extension asked the Map for (a follow or a show), and when. */
    private asked: { path: string; at: number } | null = null;
    /** The last file opened from the Map, and when. */
    private echo: { path: string; at: number } | null = null;

    constructor(private readonly now: () => number){}

    /**
     * The editor opened `path` for the Map (a file box or a declaration, or What depends' pick): its editor change is an
     * echo for ECHO_MS. The Map shows `shows`: the path itself after a pick on the Map, the pick's target after What
     * depends (its highlights select nothing). A pick on the Map is newer than any ask, so the ask is dropped.
     */
    opened(path: string, shows: string = path): void {
        this.shown = shows;
        this.asked = null;
        this.echo = { path, at: this.now() };
    }

    /** The extension posted a follow or a show for `path`. */
    posted(path: string): void {
        this.shown = path;
        this.asked = { path, at: this.now() };
    }

    /** The Map says it shows `path` (each `drawn`'s `selected`); null when it shows no file. */
    mapShows(path: string | null): void {
        this.shown = path;
    }

    /** Whether to follow the editor to `path`. A follow let through counts as asked from then on. */
    shouldFollow(path: string): boolean {
        if (this.echo !== null && this.echo.path === path && this.now() - this.echo.at < ECHO_MS) return false;
        if (path === this.current()) return false;
        this.posted(path);
        return true;
    }

    /** A new handshake (`ready`): the Map's page is new, so what it shows, or was asked, is unknown. The echo window stays. */
    reset(): void {
        this.shown = null;
        this.asked = null;
    }

    /** What the Map shows as far as the gate knows: a fresh ask, else the Map's last word. */
    private current(): string | null {
        return this.asked !== null && this.now() - this.asked.at < ASKED_MS ? this.asked.path : this.shown;
    }
}
