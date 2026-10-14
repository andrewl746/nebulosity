/**
 * Runs once when the Next server starts (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). It starts
 * the background worker (ADR-038), which watches the active repo and keeps its index current while the Map is open.
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    // next build loads this file too, and a file watcher has no business running during a build
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    // a server started only to measure (S3, the demo) must not fork a second writer beside the Map's (ADR-038, amended)
    if (process.env.NEBULOSITY_WORKER === "off") return;
    const { backgroundSupervisor } = await import("./lib/background/start");
    backgroundSupervisor();
}
