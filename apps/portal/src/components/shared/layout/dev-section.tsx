"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Wrench } from "lucide-react";

import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import { DEV_ROUTE, isLocalhostHost } from "@/lib/dev-actions";

/**
 * A developer-only link pinned to the bottom of the v2 sidebar, beside the
 * avatar, leading to the `/dev` page. The page is the destination; this block
 * is deliberately nothing more than the way there.
 *
 * It used to carry the reset actions itself. They moved to the page
 * (`components/dev/dev-page.tsx`) and the logic behind them to
 * `lib/dev-actions.ts`, which both the page and — through `isLocalhostHost`
 * and `DEV_ROUTE` — this link import, so nothing about "what first-time
 * means" is written down twice.
 *
 * It is NOT the old Dev Panel. That was deleted on purpose (3,762 lines across
 * three apps) and must not come back.
 *
 * ── THE TWO GATES ─────────────────────────────────────────────────────────
 * Both are required, and they guard different failures.
 *
 * 1. BUILD  `process.env.NODE_ENV === "development"`, checked in `DevSection`
 *    below before anything else happens. Next/webpack substitutes that
 *    expression with the string literal at build time, so in a production
 *    build the guard reads `if ("production" === "development") return …;
 *    return null;` — a constant condition. The minifier drops the dead
 *    branch, `DevSectionBody` (referenced from nowhere else in the program)
 *    is then tree-shaken out with it, and the wrapper collapses to
 *    `return null`. This is why the guard sits in a wrapper with NO hooks and
 *    NO other statements — and why the DEVELOPMENT branch comes first. The
 *    inverted shape, `if (!dev) return null; return <Body />`, only becomes
 *    dead code after an unconditional return, and a bundler builds its
 *    reference graph before it notices that: the body survived into the
 *    production bundle (esbuild proved it). Do not "tidy" the order.
 *
 * 2. RUNTIME  the browser must actually be on localhost, AND the tenant must
 *    be the northwind canary — the same two checks the page makes, using the
 *    same `isLocalhostHost`. The hostname check is belt-and-braces for the
 *    first gate: a `next dev` server bound to a LAN address, a preview built
 *    with NODE_ENV unset, or a dev build served from a tunnel all still
 *    render nothing.
 *
 * ── WHY THE TENANT GATE IS KEYED ON SLUG ──────────────────────────────────
 * `isLeanTenant` takes a slug because `northwind` has a DIFFERENT primary key
 * in every environment — 6e5c544f-… in production, 8e6bc88f-… on the staging
 * branch, because staging was seeded rather than cloned. An id-keyed gate
 * resolves to the ungated path in whichever environment it was not written
 * against, with no error and no failed build. Never key this on an id.
 *
 * The slug read is `tenant.slug` — the row that actually came back — and not
 * `tenantSlug`, which TenantContext derives from `window.location.hostname` in
 * a `useEffect` before any lookup has run. A host that merely *spells* the
 * canary in an environment where the canary does not exist cannot open the
 * link. Both are null for the first tick on every load, so the link renders
 * nothing until they resolve, exactly like every other tenant-gated surface.
 */

// ── The gate wrapper ───────────────────────────────────────────────────────

/**
 * GATE 1 of 2 — the build gate, and nothing else.
 *
 * No hooks, no state, no other statements, and the development branch FIRST
 * — see the header for why the order matters. Do not add anything above the
 * guard.
 */
export function DevSection() {
  if (process.env.NODE_ENV === "development") return <DevSectionBody />;
  return null;
}

// ── The link itself ────────────────────────────────────────────────────────

function DevSectionBody() {
  const { tenant } = useTenant();

  /**
   * GATE 2a — the hostname. Resolved in an effect rather than read inline so
   * the server render and the first client render agree (both `false`) and
   * React does not tear the tree down over a hydration mismatch.
   */
  const [onLocalhost, setOnLocalhost] = useState(false);
  useEffect(() => {
    setOnLocalhost(isLocalhostHost(window.location.hostname));
  }, []);

  /** GATE 2b — the tenant, by slug, from the row that actually loaded. */
  if (!onLocalhost || !isLeanTenant(tenant?.slug)) return null;

  return (
    <Link
      href={DEV_ROUTE}
      // Dashed border + monospace + no brand colour: it borrows the v2 tokens
      // so it does not look broken next to the avatar, while looking like
      // nothing else in the product does.
      className="mb-1.5 flex w-full items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      data-testid="dev-section"
      title="Open the developer page (local only)"
    >
      <Wrench className="h-3 w-3 shrink-0" />
      <span className="flex-1 text-left">Developer</span>
      <span className="normal-case tracking-normal opacity-60">local</span>
      <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />
    </Link>
  );
}
