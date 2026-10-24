/**
 * When a change of the active editor should move the Map (P16). Following is "the Map shows the file you're in", so the
 * gate keeps the path the Map was last known to show, and lets a follow through only to a path it doesn't show already.
 * A file opened from the Map is an echo: VS Code reports it as an editor change, and following it back would undo
 * whatever the Map did since (a pick on another box), so it's held off for ECHO_MS.
 */

/** How long the active editor has to stay put before the Map follows it: a burst of switches gives one follow. */
export const FOLLOW_DEBOUNCE_MS = 150;

/** How long a file opened from the Map is kept from being followed back. */
export const ECHO_MS = 2_000;

export class FollowGate {
    /** The path the Map was last known to show, or null when that's unknown (after a reset). */
    private shown: string | null = null;
    /** The last file opened from the Map, and when. */
    private echo: { path: string; at: number } | null = null;

    constructor(private readonly now: () => number){}

    /** The Map asked the editor to open `path`: the Map shows it, and its editor change is an echo for ECHO_MS. */
    opened(path: string): void {
        this.shown = path;
        this.echo = { path, at: this.now() };
    }

    /** The Map shows `path` (each `drawn`'s `selected`, and each `show` posted); null when it shows no file. */
    mapShows(path: string | null): void {
        this.shown = path;
    }

    /** Whether to follow the editor to `path`. A follow let through counts as what the Map shows from then on. */
    shouldFollow(path: string): boolean {
        if (this.echo !== null && this.echo.path === path && this.now() - this.echo.at < ECHO_MS) return false;
        if (path === this.shown) return false;
        this.shown = path;
        return true;
    }

    /** A new handshake (`ready`): the Map's page is new, so what it shows is unknown. The echo window stays. */
    reset(): void {
        this.shown = null;
    }
}
