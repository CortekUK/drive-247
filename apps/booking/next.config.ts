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
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  // The multi-page /booking flow is deprecated — the only booking path is the
  // home-page widget. Redirect any stray link into that dead flow back home so
  // customers can never get stranded in it. (Note: /booking-enquiry-submitted is
  // a separate route and is intentionally NOT matched here.)
  async redirects() {
    return [
      { source: '/booking', destination: '/', permanent: false },
      { source: '/booking/:path*', destination: '/', permanent: false },
    ];
  },
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
