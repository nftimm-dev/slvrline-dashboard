import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 5 will add pages; for Phase 4 this is an API-only app
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
