import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
