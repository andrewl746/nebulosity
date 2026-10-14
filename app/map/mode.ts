/**
 * True in the static demo's build (ADR-049). `npm run build-demo` builds with NEBULOSITY_DEMO=1, which next.config.ts
 * turns into NEXT_PUBLIC_NEBULOSITY_DEMO for the browser; Next inlines it at build time. The local app never sets it.
 */
export const DEMO = process.env.NEXT_PUBLIC_NEBULOSITY_DEMO === "1";
