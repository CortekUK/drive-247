import type { NextConfig } from "next";
import dotenv from "dotenv";

// Load env vars from monorepo root .env
dotenv.config({ path: "../../.env" });

const nextConfig: NextConfig = {
  typescript: {
    // Root monorepo has @types/react@18, web app uses React 19.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
