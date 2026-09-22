"use client";

import Link from "next/link";
import { ArrowUpRight, Wrench } from "lucide-react";

import { useTenant } from "@/contexts/TenantContext";
import { NORTHWIND } from "@/lib/v2";
import { DEV_ROUTE } from "@/lib/dev-actions";

/**
 * A developer link pinned to the bottom of the v2 sidebar, beside the avatar,
 * leading to the `/dev` page. The page is the destination; this block is
 * deliberately nothing more than the way there.
 *
 * It used to carry the reset actions itself. They moved to the page
 * (`components/dev/dev-page.tsx`) and the logic behind them to
 * `lib/dev-actions.ts`, which both the page and — through `DEV_ROUTE` — this
 * link import, so nothing about "what first-time means" is written down twice.
 *
 * It is NOT the old Dev Panel. That was deleted on purpose (3,762 lines across
 * three apps) and must not come back.
 *
 * ── ONE GATE, AND WHY THE OTHER TWO WENT (Sep 20 2026) ────────────────────
 * This link used to carry three gates: a BUILD gate (`process.env.NODE_ENV ===
 * "development"`, which folded the body out of a production bundle), a HOST
 * gate (the browser had to be on localhost) and a TENANT gate. The request was
 * to see the developer tool on the live portal, and the first two are exactly
 * what stopped that — so both are gone, deliberately, and the consequences are
 * written down here rather than left to be rediscovered:
 *
 *   - `DevSectionBody`, `DevPageBody` and everything they import from
 *     `lib/dev-actions` are now in the PRODUCTION bundle as shipped, reachable
 *     code. The one database write in there is a `delete` on
 *     `tenant_first_run` scoped to the open tenant's own id (a table that does
 *     not even exist in production, so it answers "absent"); the rest is
 *     localStorage. That is the whole blast radius, and it is why this was
 *     judged safe to ship. If a further action is ever added to that page,
 *     this sentence stops being true and the gate below has to be revisited.
 *
 *   - The wrapper/body split that existed ONLY to make the fold work is gone
 *     with it. There is nothing left to "tidy in the wrong order".
 *
 * ── THE GATE THAT REMAINS, AND WHY IT IS A SLUG AND NOT `useIsLean()` ──────
 * `tenant.slug === NORTHWIND`, and nothing else.
 *
 * This is NOT the same question as `useIsLean()`, which is what the localhost
 * version asked. Lean is now `slug ∈ LEAN_TENANTS || tenants.portal_experience
 * = 'v2'`, and in production that column is already `'v2'` for `nasir` and
 * `squad` as well as `northwind` — with every self-serve signup landing on v2
 * from now on. On localhost the difference was invisible; on live it would have
 * put a developer tool in front of real operators. So the gate is the canary's
 * slug, which is what "northwind only" actually means.
 *
 * Keyed on the SLUG, never an id: `northwind` is 6e5c544f-… in production and
 * 8e6bc88f-… on the staging branch, because staging was seeded rather than
 * cloned. An id-keyed gate resolves to the ungated path in whichever
 * environment it was not written against, with no error and no failed build.
 *
 * The slug read is `tenant.slug` — the row that actually came back — and not
 * `tenantSlug`, which TenantContext derives from `window.location.hostname` in
 * a `useEffect` before any lookup has run. A host that merely *spells* the
 * canary in an environment where the canary does not exist cannot open the
 * link. It is null for the first tick on every load, so the link renders
 * nothing until the row resolves, exactly like every other tenant-gated
 * surface.
 */
export function DevSection() {
  const { tenant } = useTenant();

  /** The one gate. Fails closed on a tenant that has not resolved yet. */
  if (tenant?.slug !== NORTHWIND) return null;

  return (
    <Link
      href={DEV_ROUTE}
      // Dashed border + monospace + no brand colour: it borrows the v2 tokens
      // so it does not look broken next to the avatar, while looking like
      // nothing else in the product does.
      className="mb-1.5 flex w-full items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors cursor-pointer hover:border-foreground/30 hover:text-foreground"
      data-testid="dev-section"
      title="Open the developer page (canary tenant only)"
    >
      <Wrench className="h-3 w-3 shrink-0" />
      <span className="flex-1 text-left">Developer</span>
      <span className="normal-case tracking-normal opacity-60">canary</span>
      <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />
    </Link>
  );
}
