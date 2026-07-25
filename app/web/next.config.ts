import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `postgres` is a native driver — keep it external rather than bundled.
  serverExternalPackages: ["postgres"],
  // The cron route imports the metrics job (computeAndWrite) straight from the
  // TypeScript source of the workspace package, so Next must transpile it.
  transpilePackages: ["@slvrline/metrics"],
};

export default nextConfig;
