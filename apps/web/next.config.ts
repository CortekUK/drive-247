import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Root monorepo has @types/react@18, web app uses React 19.
    // This causes false type conflicts during build. Types are
    // checked separately via the editor / CI lint step.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
