import { headers } from 'next/headers';

/**
 * The current tenant's SLUG, read on the server, for deciding which version of
 * a screen renders.
 *
 * There is deliberately no database call here. `src/proxy.ts` already extracts
 * the slug from the subdomain ({tenant}.portal.drive-247.com) and injects it as
 * `x-tenant-slug`, so the answer is sitting in the request headers. An earlier
 * version of this file looked the slug up in Supabase to turn it into a tenant
 * id, purely so the gate could compare UUIDs — a round trip on EVERY portal
 * page load, for all 57 tenants, to learn something the request already knew.
 *
 * Keying gates on the slug also removes an entire class of bug. `northwind`
 * exists in production and on the staging branch with different primary keys,
 * so an id-keyed gate silently resolved to v1 on localhost while working in
 * production — no error, no failed build, no failed check. The slug is stable
 * everywhere.
 *
 * Server-only by construction: `next/headers` throws if this is imported into
 * a Client Component, which is the guarantee we want. Client components read
 * the resolved flags from `lib/v2-context` instead — see V2_PLAN §3.
 *
 * Locally this means visiting `northwind.portal.localhost:3001`, not plain
 * `localhost:3001` — on the bare host there is no slug, this returns null, and
 * every gate falls back to v1.
 *
 * NOTE: portal's tenant middleware lives in `proxy.ts`, not `middleware.ts`
 * (Next.js 16 renamed the hook). CLAUDE.md still says `middleware.ts` and is
 * wrong about it.
 */
export async function tenantSlugFromHeaders(): Promise<string | null> {
  try {
    const headersList = await headers();
    return headersList.get('x-tenant-slug');
  } catch {
    // Never let a gate lookup take a page down. Null means v1, and v1 is the
    // screen every tenant already had.
    return null;
  }
}
