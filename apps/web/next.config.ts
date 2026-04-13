import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Root monorepo has @types/react@18, web app uses React 19.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
