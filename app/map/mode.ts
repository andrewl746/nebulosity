/**
 * True in the static demo's build (ADR-049). `npm run build-demo` builds with NEBULOSITY_DEMO=1, which next.config.ts
 * turns into NEXT_PUBLIC_NEBULOSITY_DEMO ("1" in the demo, "0" in the app) for the browser; Next inlines it at build
 * time. For the components. The transport's own switch is written inline in api.ts, so the bundler can drop the demo's
 * code from the app.
 */
export const DEMO = process.env.NEXT_PUBLIC_NEBULOSITY_DEMO === "1";
