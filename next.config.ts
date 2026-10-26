import type { NextConfig } from "next";

// The static demo (ADR-049): `npm run build-demo` builds with NEBULOSITY_DEMO=1. Route handlers, proxy.ts and
// instrumentation.ts are .ts files, and Next resolves those by page extension, so "tsx" alone leaves the server out:
// the Map (page.tsx, layout.tsx) is all that's built, and it reads the exported files instead of /api.
const demo = process.env.NEBULOSITY_DEMO === "1";

// Who may frame the Map's pages (V1.8, ADR-062): itself, and the VS Code extension's webview, whose iframe sits in a
// vscode-webview: page (vscode-file: is the desktop app's own scheme). Any other site can't put the Map in a frame.
export const FRAME_ANCESTORS = "frame-ancestors 'self' vscode-webview: vscode-file:";

const nextConfig: NextConfig = {
  // React Flow v12's controlled-mode node measurement can be dropped by
  // Strict Mode's dev-only double-invoke, leaving nodes hidden/unmeasured
  // (no edges, no fitView). Disable the double-invoke. Production is
  // unaffected (it never double-invokes).
  reactStrictMode: false,
  // Set in both builds ("0" for the app): Next inlines a NEXT_PUBLIC_ value only when it is set, and an unset one
  // would leave the demo's transport in the app's bundle (app/map/api.ts).
  env: { NEXT_PUBLIC_NEBULOSITY_DEMO: demo ? "1" : "0" },
  ...(demo ? {
    output: "export",
    pageExtensions: ["tsx"],
    images: { unoptimized: true },
  } : {
    // an exported site can't have headers (Next refuses them under output: "export"), so only the app's build sets this
    headers: async () => [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: FRAME_ANCESTORS }] }],
  }),
};

export default nextConfig;
