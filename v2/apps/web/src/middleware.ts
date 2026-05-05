import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { BASE_DOMAIN, RESERVED_SUBDOMAINS } from "@/lib/constants";

const TENANT_HEADER = "x-tenant-slug";
const FALLBACK_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ?? "";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  const tenant = resolveTenantSlug(host);

  const requestHeaders = new Headers(request.headers);
  if (tenant) {
    requestHeaders.set(TENANT_HEADER, tenant);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

function resolveTenantSlug(host: string): string {
  const hostname = host.split(":")[0];
  if (!hostname) return FALLBACK_TENANT;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return FALLBACK_TENANT;
  }

  if (hostname.endsWith(".localhost")) {
    const slug = hostname.replace(/\.localhost$/, "");
    return RESERVED_SUBDOMAINS.has(slug) ? FALLBACK_TENANT : slug;
  }

  if (hostname === BASE_DOMAIN || hostname === `www.${BASE_DOMAIN}`) {
    return FALLBACK_TENANT;
  }

  if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
    const slug = hostname.slice(0, -1 - BASE_DOMAIN.length).split(".")[0];
    return RESERVED_SUBDOMAINS.has(slug) ? FALLBACK_TENANT : slug;
  }

  return FALLBACK_TENANT;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
