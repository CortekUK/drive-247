import type { NextConfig } from "next";
import dotenv from "dotenv";

// Load env vars from monorepo root .env
dotenv.config({ path: "../../.env" });

function configuredGhlFrameSources(): string[] {
  const candidates = [
    process.env.NEXT_PUBLIC_GHL_BOOKING_URL ||
      "https://api.leadconnectorhq.com/widget/booking/5IaMFcRJ2O4R589QF89C",
    ...(process.env.NEXT_PUBLIC_GHL_ALLOWED_ORIGINS?.split(",") ?? []),
  ];

  return [...new Set(candidates.flatMap((candidate) => {
    try {
      const url = new URL(candidate.trim());
      return url.protocol === "https:" ? [url.origin] : [];
    } catch {
      return [];
    }
  }))];
}

const strategyCallCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.facebook.com",
  "font-src 'self' data:",
  `frame-src ${configuredGhlFrameSources().join(" ") || "'none'"}`,
  "media-src 'self' blob:",
  "connect-src 'self' https://www.facebook.com https://*.supabase.co",
].join("; ");

const nextConfig: NextConfig = {
  typescript: {
    // Root monorepo has @types/react@18, web app uses React 19.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: "/strategy-call/:path*",
        headers: [
          { key: "Content-Security-Policy", value: strategyCallCsp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/strategy-call/confirmation",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
