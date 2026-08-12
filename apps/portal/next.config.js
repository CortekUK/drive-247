const dotenv = require('dotenv');
dotenv.config({ path: '../../.env' });

// Public home of the platform legal documents. Overridable so local dev can
// point at the marketing app on :3002 instead of production.
const MARKETING_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL || 'https://drive-247.com';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['test.portal.localhost', '*.portal.localhost'],

  // ── Legal documents live on the marketing site, not here ──────────────────
  //
  // There used to be TWO different versions of the operator↔Drive247 agreement:
  // one at drive-247.com/terms and a second, differently-worded one served by
  // the portal's own (auth)/terms page. Two documents both claiming to be the
  // platform terms is a real problem once a tenant is charged against one of
  // them, so the marketing page is now canonical and this route redirects there.
  //
  // REDIRECT RATHER THAN DELETE — deliberately. The portal links to /terms and
  // /privacy-policy from the login page's MANDATORY acceptance checkbox, which
  // hard-blocks sign-in until ticked. Deleting the routes would 404 the one
  // screen where a user legally attests to having read them. A redirect keeps
  // every existing link, bookmark and email working.
  //
  // 307 (permanent: false), NOT 308. The canonical URL is still pending final
  // confirmation, and browsers cache a 308 indefinitely — a wrong permanent
  // redirect cannot be recalled from users' caches.
  async redirects() {
    return [
      {
        source: '/terms',
        destination: `${MARKETING_URL}/terms`,
        permanent: false,
      },
      {
        // Note the path change: the portal linked /privacy-policy, the
        // marketing site serves /privacy. The redirect absorbs the mismatch so
        // neither the login page nor any older link has to know about it.
        source: '/privacy-policy',
        destination: `${MARKETING_URL}/privacy`,
        permanent: false,
      },
    ];
  },

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
