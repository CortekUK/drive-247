import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side tenant resolution, for deciding which version of a screen renders.
 *
 * Server-only by construction: `next/headers` throws if this is ever imported
 * into a Client Component, which is the guarantee we want. (`server-only` is
 * not a dependency of this app and is not worth adding one for.)
 *
 * v2 gates are resolved HERE — on the server, once, at the route level — and
 * never in a client effect. Resolving after hydration would either blank the
 * page for every tenant while the tenant loads, or paint v1 and swap, which
 * reads as a broken page on exactly the tenants you switched on.
 *
 * `x-tenant-slug` is injected by `src/proxy.ts` from the subdomain
 * ({tenant}.portal.drive-247.com). Locally that means visiting
 * `northwind.portal.localhost:3001`, not plain `localhost:3001` — on the bare
 * host there is no slug, so this returns null and every gate falls back to v1.
 *
 * NOTE: portal's tenant middleware lives in `proxy.ts`, not `middleware.ts`
 * (Next.js 16 renamed the hook). CLAUDE.md still says `middleware.ts` and is
 * wrong about it.
 */
export async function tenantIdFromHeaders(): Promise<string | null> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');
    if (!tenantSlug) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;

    const supabase = createClient(url, anonKey);

    // `maybeSingle`, not `single`: an unknown slug is a normal condition here
    // (a reserved subdomain, a typo, a deleted tenant) and must resolve to null
    // rather than throwing.
    const { data } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .maybeSingle();

    return data?.id ?? null;
  } catch {
    // Never let a gate lookup take a page down. Null means v1, and v1 is the
    // screen every tenant already had.
    return null;
  }
}
