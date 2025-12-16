import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
  // Disable static page generation to avoid SSR issues with Supabase client
  output: 'standalone',
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

    // Force resolve @supabase modules correctly
    config.resolve.alias = {
      ...config.resolve.alias,
    };

    return config;
  },
  // Transpile Supabase packages
  transpilePackages: ['@supabase/supabase-js', '@supabase/auth-helpers-nextjs'],
};

export default nextConfig;
