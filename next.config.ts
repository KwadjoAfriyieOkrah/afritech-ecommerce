import type { NextConfig } from "next";

const backendApiUrl = process.env.BACKEND_API_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /* config options here */
  "allowedDevOrigins": ["http://localhost:3000", "http://localhost:3001"],
  async rewrites() {
    if (!backendApiUrl) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${backendApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
