import type { NextConfig } from 'next';
import path from 'path';
import { config } from 'dotenv';

// Load environment variables from workspace root .env file
config({ path: path.resolve(__dirname, '../../.env') });

const nextConfig: NextConfig = {
  allowedDevOrigins: ['test.localhost', '*.localhost'],
  typescript: {
    // Disable type checking during build for now
    ignoreBuildErrors: true,
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    // lucide-react-nw: the new Northwind design's icon version (an npm alias).
    optimizePackageImports: ['lucide-react', 'lucide-react-nw', '@radix-ui/react-icons'],
    // src/app/global-not-found.tsx: the 404 for unknown addresses. Required now
    // that the app has two root layouts ((legacy) and (northwind)).
    globalNotFound: true,
  },
  // The multi-page /booking flow is deprecated — the only booking path is the
  // home-page widget — and stray links into it are sent back home. That redirect
  // now lives in src/lib/booking-design.ts (applied by the middleware): a
  // redirect here runs before the middleware, so it could not tell tenants
  // apart, and the new Northwind design's booking flow DOES live at /booking.
  // Standalone output for Vercel deployment
  output: 'standalone',
  // Set workspace root to fix monorepo lockfile detection
  outputFileTracingRoot: path.join(__dirname, '../../'),
  webpack: (config, { isServer }) => {
    // Fix for Supabase module resolution in Next.js 15
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };

    // Fix for @supabase/supabase-js ESM module issue
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    return config;
  },
};

export default nextConfig;
