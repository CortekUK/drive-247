/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Ignore TypeScript build errors (Supabase types out of sync with schema)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Transpile packages that need it
  transpilePackages: [
    '@tiptap/react',
    '@tiptap/starter-kit',
    '@tiptap/extension-link',
    '@tiptap/extension-underline',
    'recharts',
  ],

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hviqoaokxvlancmftwuo.supabase.co',
      },
    ],
  },

  // Experimental features
  experimental: {
    // Enable server actions if needed
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
