import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Flow v12's controlled-mode node measurement can be dropped by
  // Strict Mode's dev-only double-invoke, leaving nodes hidden/unmeasured
  // (no edges, no fitView). Disable the double-invoke. Production is
  // unaffected (it never double-invokes).
  reactStrictMode: false,
};

export default nextConfig;
