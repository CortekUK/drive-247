import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@drive247/ui',
    '@drive247/api-client',
    '@drive247/shared-types',
    '@drive247/validators',
  ],
};

export default nextConfig;
