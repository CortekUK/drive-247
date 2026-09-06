import type { NextConfig } from 'next';

/**
 * The host operator media is served from.
 *
 * Every image an operator uploads through the portal lands in the `cms-media`
 * bucket on Supabase Storage, which is a REMOTE host as far as `next/image` is
 * concerned — and `next/image` refuses to render a remote URL that is not
 * declared here. Without this, the first image an operator swaps on their home
 * page would render as a 400 rather than as their photograph.
 *
 * Derived from the project's own Supabase URL so staging and production each
 * allow their own bucket and nothing else, with a wildcard fallback for the
 * case where the variable is absent at build time (it is set on Vercel, but a
 * missing env var must not turn every uploaded image into an error page).
 */
const supabaseHostname = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseHostname
        ? ([
            {
              protocol: 'https' as const,
              hostname: supabaseHostname,
              pathname: '/storage/v1/object/public/**',
            },
          ])
        : []),
      {
        protocol: 'https' as const,
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
