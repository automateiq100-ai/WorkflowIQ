import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
  async rewrites() {
    return [
      // Proxy ResearchIQ root (serves index.html)
      {
        source: '/researchiq',
        destination: 'http://localhost:3001/',
      },
      // Proxy all ResearchIQ sub-paths (API, static assets, etc.)
      {
        source: '/researchiq/:path*',
        destination: 'http://localhost:3001/:path*',
      },
    ];
  },
};

export default nextConfig;
