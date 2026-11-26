import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@sentry/node"],
  async rewrites() {
    return [
      // The MCP server at a short address, and the OAuth discovery documents where clients look for them.
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/openid-configuration", destination: "/api/oauth/metadata" },
      { source: "/.well-known/openid-configuration/:path*", destination: "/api/oauth/metadata" },
    ];
  },
};

export default nextConfig;
