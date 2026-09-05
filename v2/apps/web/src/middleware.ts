import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { supabase } from "@/integrations/supabase/client";
import {
  CMS_EDIT_HEADER,
  DEV_FALLBACK_TENANT_SLUG,
  TENANT_HEADER,
  extractTenantSlugFromHost,
  isPlatformHost,
} from "@/lib/constants";

/**
 * Resolves which tenant this request belongs to and forwards it to the server
 * tree as `x-tenant-slug`.
 *
 * NOTE: Next 16 deprecates the `middleware` filename in favour of `proxy`. The
 * file is deliberately NOT renamed here — renaming it is a repo-wide convention
 * change that belongs in its own change, not buried in the data layer.
 */
export async function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";

  // 1. Subdomain — the fast path, no network call.
  let tenantSlug = extractTenantSlugFromHost(host);

  // 2. Custom booking domain. Only worth a lookup when the host is not ours;
  //    every `*.drive-247.com` / localhost host was already settled by step 1.
  if (!tenantSlug && !isPlatformHost(host)) {
    tenantSlug = await resolveCustomDomainSlug(host);
  }

  // 3. Development-only fallback. Gated on NODE_ENV inside constants.ts: applied
  //    unconditionally it would serve ONE tenant to every unresolved production
  //    host.
  if (!tenantSlug) {
    tenantSlug = DEV_FALLBACK_TENANT_SLUG;
  }

  const requestHeaders = new Headers(request.headers);

  // Visual-editor mode. The portal embeds this site with `?cms-edit=1`; the
  // server tree reads the header (never the query string — Server Components
  // in a layout cannot see searchParams) to render DRAFT content and mount
  // the edit overlay. Stripped first so a client cannot smuggle it in as a
  // header. See lib/cms/server.ts and components/cms/edit-overlay.tsx.
  requestHeaders.delete(CMS_EDIT_HEADER);
  if (request.nextUrl.searchParams.get("cms-edit") === "1") {
    requestHeaders.set(CMS_EDIT_HEADER, "1");
  }

  if (tenantSlug) {
    requestHeaders.set(TENANT_HEADER, tenantSlug);
  } else {
    // Strip any inbound spoof so a client cannot pick its own tenant by sending
    // the header we trust downstream.
    requestHeaders.delete(TENANT_HEADER);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Look up a tenant by the custom domain they pointed at us. Suspended tenants
 * are included so their site still resolves and can render an "unavailable"
 * state rather than silently becoming an untenanted page.
 */
async function resolveCustomDomainSlug(host: string): Promise<string | null> {
  let hostname = host.split(":")[0];
  if (hostname.startsWith("www.")) {
    hostname = hostname.slice(4);
  }
  if (!hostname) return null;

  const { data, error } = await supabase
    .from("tenants")
    .select("slug")
    .eq("custom_booking_domain", hostname)
    .in("status", ["active", "suspended"])
    .maybeSingle();

  if (error) {
    console.error("[middleware] custom domain lookup failed", {
      hostname,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return null;
  }

  return data?.slug ?? null;
}

export const config = {
  matcher: [
    // `api` and the `.*\..*` (any dotted path) clauses are load-bearing, not
    // tidiness: this middleware performs a BLOCKING `tenants` lookup for hosts
    // on a custom booking domain. Without them every static asset request —
    // public/booking_landingpage/ alone holds 22 images — would pay its own
    // serialized DB round-trip before the response is released, so a page
    // pulling six images costs six extra queries on the critical path.
    // Mirrors apps/booking/src/middleware.ts.
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
    // Re-included explicitly, OR'd with the pattern above. Both are dotted
    // paths the rule above now drops, and both are per-tenant responses that
    // must carry the tenant header — otherwise a tenant's install prompt and
    // tab icon come out branded as the PLATFORM.
    "/manifest.webmanifest",
    "/favicon.ico",
  ],
};
