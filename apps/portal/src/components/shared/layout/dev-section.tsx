"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RotateCcw, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import { isV2, type V2Area } from "@/lib/v2";
import { firstRunQueryKey } from "@/hooks/use-first-run-wizard";

/**
 * A developer-only block pinned to the bottom of the v2 sidebar, beside the
 * avatar. It exists to re-run the first-run onboarding experience — the tour,
 * the wizard, the setup checklist — without hand-editing localStorage or
 * hand-writing SQL between every pass.
 *
 * It is NOT the old Dev Panel. That was deleted on purpose (3,762 lines across
 * three apps) and must not come back. This is four buttons and a readout.
 *
 * ── THE TWO GATES ─────────────────────────────────────────────────────────
 * Both are required, and they guard different failures.
 *
 * 1. BUILD  `process.env.NODE_ENV === "development"`, checked in `DevSection`
 *    below before anything else happens. Next/webpack substitutes that
 *    expression with the string literal at build time, so in a production
 *    build the guard reads `if ("production" !== "development") return null;`
 *    — a constant condition. The minifier folds it, the body collapses to
 *    `return null`, and `DevSectionBody` (referenced from nowhere else in the
 *    program) is tree-shaken out with it. Nothing below this line — not the
 *    markup, not the reset actions, not the Supabase delete — can reach a
 *    production bundle. This is why the guard sits in a wrapper with NO hooks
 *    and NO other statements: the early return has to be the whole function.
 *
 * 2. RUNTIME  the browser must actually be on localhost, AND the tenant must
 *    be the northwind canary. The hostname check is belt-and-braces for the
 *    first gate: a `next dev` server bound to a LAN address, a preview built
 *    with NODE_ENV unset, or a dev build served from a tunnel all still
 *    render nothing. Portal's dev port is 4002 (4001–4005 across the apps),
 *    never 3000–3005; the port is irrelevant to the check, the host is not.
 *
 * ── WHY THE TENANT GATE IS KEYED ON SLUG ──────────────────────────────────
 * `isLeanTenant` takes a slug because `northwind` has a DIFFERENT primary key
 * in every environment — 6e5c544f-… in production, 8e6bc88f-… on the staging
 * branch, because staging was seeded rather than cloned. An id-keyed gate
 * resolves to the ungated path in whichever environment it was not written
 * against, with no error and no failed build: the code is right, the build is
 * right, and the block simply never appears. Never key this on an id.
 *
 * The slug read is `tenant.slug` — the row that actually came back — and not
 * `tenantSlug`, which TenantContext derives from `window.location.hostname` in
 * a `useEffect` before any lookup has run. Keying on the resolved row buys two
 * things for free: a host that merely *spells* the canary in an environment
 * where the canary does not exist cannot open the block, and `tenant.id` is
 * guaranteed to be in hand before any reset writes anything. Both are null for
 * the first tick on every load, so the block renders nothing until they
 * resolve, exactly like every other tenant-gated surface here.
 */

// ── Tour hookup ────────────────────────────────────────────────────────────

type TourReplay = () => void;

/**
 * The first-rental tour's replay signal.
 *
 * This is `REPLAY_TOUR_EVENT` from `@/lib/first-rental-tour`, duplicated as a
 * literal rather than imported ON PURPOSE: that module is being written in a
 * parallel session and is not in HEAD yet, so a hard import would make this
 * file fail to resolve for anyone who has this commit and not that one. The
 * tour's own hook already listens for the event name, so nothing needs to
 * change on their side for this button to work.
 *
 * ONE-LINE UPGRADE once `lib/first-rental-tour.ts` is committed: replace this
 * constant with `import { REPLAY_TOUR_EVENT } from '@/lib/first-rental-tour'`
 * and the duplication is gone. Worth doing — it is the only place the two
 * halves can drift.
 */
const REPLAY_TOUR_EVENT = 'replay-first-rental-tour';

/** A generic signal, for any other tour that would rather listen than register. */
const DEV_REPLAY_EVENT = 'drive247:dev:replay-tour';

/**
 * A tour that would rather be CALLED than listen for an event registers itself
 * here when it mounts. The whole hookup is one line, from inside the tour's
 * own component:
 *
 *     useEffect(() => registerDevTourReplay(() => startTour()), [startTour]);
 *
 * `registerDevTourReplay` returns its own unregister function, so that single
 * `useEffect` also cleans up on unmount — no second line and no edit here.
 *
 * Nothing uses this today; the event above is what actually drives the current
 * tour. It exists because the alternative — this file having to be edited
 * whenever a tour changes how it starts — is the thing worth avoiding.
 */
let tourReplay: TourReplay | null = null;

export function registerDevTourReplay(fn: TourReplay): () => void {
  tourReplay = fn;
  return () => {
    // Guard the identity: a remount registers the new callback before the old
    // one's cleanup runs, and an unconditional clear would wipe the live one.
    if (tourReplay === fn) tourReplay = null;
  };
}

/**
 * Matches the tour's per-user seen-key, `d247.tour.first-rental.v1.<appUserId>`,
 * without having to know the app user's id or the version — both of which the
 * tour is free to change. A pattern rather than an exact key because the seen
 * flag is keyed per USER: a shared machine has one key per person who has
 * signed in, and a replay should re-arm all of them, not just the current one.
 */
const TOUR_KEY_PATTERN = /tour/i;

/** localStorage keys that look like they belong to the tour. */
function tourStorageKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && TOUR_KEY_PATTERN.test(key)) keys.push(key);
    }
  } catch {
    // Reading storage throws in some privacy modes. A dev block is never worth
    // taking the sidebar down for.
  }
  return keys;
}

// ── Storage keys owned by the surfaces this block resets ───────────────────

/**
 * Every localStorage/sessionStorage key that holds "the operator has already
 * dealt with the setup checklist" state, all suffixed with the tenant id.
 *
 * Kept in one list, with the file that writes each one named, because these
 * are the only coupling this block has to those surfaces — if a key is
 * renamed there, this is the single place that has to follow.
 */
function checklistStorageKeys(tenantId: string): string[] {
  return [
    // components/dashboard-v2/setup-guide.tsx — panel expanded/minimized/closed
    `setup-guide-state-${tenantId}`,
    // components/dashboard/getting-started-checklist.tsx — the legacy card
    `getting-started-collapsed-${tenantId}`,
    `getting-started-dismissed-${tenantId}`,
    `getting-started-completed-at-${tenantId}`,
    // components/dashboard/setup-reminder-dialog.tsx — "don't show me again"
    `setup-reminder-dismissed-${tenantId}`,
    // …and its per-session snooze, which lives in sessionStorage (cleared too)
    `setup-reminder-snoozed-${tenantId}`,
  ];
}

/**
 * The v2 areas reported in the readout.
 *
 * Typed `V2Area[]` on purpose: retiring an area in `lib/v2.ts` narrows the
 * union and makes the stale literal here a compile error, so the readout
 * cannot quietly report on a gate that no longer exists. (Adding an area is
 * not caught — the readout just will not mention it until it is listed here.)
 */
const V2_AREAS_REPORTED: V2Area[] = [
  "appearance",
  "theme",
  "dashboard",
  "chrome",
  "login",
  "rentals",
];

function isLocalhostHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

// ── The gate wrapper ───────────────────────────────────────────────────────

/**
 * GATE 1 of 2 — the build gate, and nothing else.
 *
 * No hooks, no state, no other statements: the early return has to be the
 * entire function for the minifier to collapse it and drop `DevSectionBody`.
 * Do not add anything above the guard.
 */
export function DevSection() {
  if (process.env.NODE_ENV !== "development") return null;
  return <DevSectionBody />;
}

// ── The block itself ───────────────────────────────────────────────────────

function DevSectionBody() {
  const { tenant, tenantSlug } = useTenant();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
  const isCanary = isLeanTenant(tenant?.slug);

  const readout = useMemo(() => {
    const v2On = V2_AREAS_REPORTED.filter((a) => isV2(a, tenant?.slug));
    return [
      ["tenant", tenant?.slug ?? "—"],
      // Worth showing next to the row's slug: when these two disagree the host
      // resolved to a tenant that is not the one the URL names.
      ["host slug", tenantSlug ?? "—"],
      ["lean", isLeanTenant(tenant?.slug) ? "yes" : "no"],
      ["v2", v2On.length ? v2On.join(" ") : "none"],
      ["env", process.env.NODE_ENV ?? "—"],
    ] as const;
  }, [tenant?.slug, tenantSlug]);

  if (!onLocalhost || !isCanary || !tenant?.id) return null;

  const tenantId = tenant.id;

  const run = async (label: string, fn: () => Promise<string> | string) => {
    setBusy(label);
    try {
      setStatus(await fn());
    } catch (err) {
      setStatus(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Re-arm the tour: clear every "already seen" flag it keeps, then ask it to
   * start again.
   *
   * Both halves are needed and they do different jobs. Clearing the seen-key
   * restores AUTOSTART, which is what actually gets tested — the tour as a
   * brand-new operator meets it on their first dashboard load. The event
   * replays it right now in this tab without a reload. Doing only the first
   * means reloading to see anything; only the second means never testing the
   * gate that decides whether it appears at all.
   */
  const replayTour = () =>
    run("tour", () => {
      const cleared = tourStorageKeys();
      cleared.forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch {
          /* nothing to do — the flag simply survives */
        }
      });

      if (tourReplay) tourReplay();
      window.dispatchEvent(new Event(REPLAY_TOUR_EVENT));
      window.dispatchEvent(new Event(DEV_REPLAY_EVENT));

      const n = cleared.length;
      return `tour: replay sent, ${n} seen-flag${n === 1 ? "" : "s"} cleared${
        n === 0 ? " (autostart was already armed)" : ""
      }`;
    });

  /**
   * Re-arm the first-run wizard by deleting this tenant's `tenant_first_run`
   * row: the row EXISTING is the "already seen" flag, so removing it is the
   * whole reset.
   *
   * `.select("id")` on the delete is load-bearing. RLS grants DELETE on that
   * table to super admins only, so a tenant-role session gets back success
   * with zero rows — indistinguishable from "there was nothing to clear"
   * unless the affected rows are counted. The count is reported either way.
   */
  const resetFirstRun = () =>
    run("first-run", async () => {
      // Untyped: `tenant_first_run` is absent from the generated types until
      // its migration is applied and types are regenerated.
      const { data, error } = await (supabase as any)
        .from("tenant_first_run")
        .delete()
        .eq("tenant_id", tenantId)
        .select("id");

      if (error) return `first-run: ${error.message}`;

      const n = Array.isArray(data) ? data.length : 0;
      await queryClient.invalidateQueries({ queryKey: firstRunQueryKey(tenantId) });
      return n > 0
        ? "first-run: cleared — reload to see the wizard"
        : "first-run: nothing to clear (already unset, or DELETE needs a super admin)";
    });

  /**
   * Re-arm the setup checklist. Its PROGRESS is derived from real data —
   * vehicles, Stripe, Bonzah — and is deliberately not faked here; what this
   * clears is the dismissal/minimize state that stops the guide from showing,
   * then drops the cached reads so the panel recomputes from scratch.
   */
  const resetChecklist = () =>
    run("checklist", async () => {
      let cleared = 0;
      for (const key of checklistStorageKeys(tenantId)) {
        try {
          if (localStorage.getItem(key) !== null) {
            localStorage.removeItem(key);
            cleared += 1;
          }
          if (sessionStorage.getItem(key) !== null) {
            sessionStorage.removeItem(key);
            cleared += 1;
          }
        } catch {
          /* storage unavailable — nothing to clear */
        }
      }
      // Key literals live in use-setup-guide.ts / use-setup-status.ts.
      await queryClient.invalidateQueries({ queryKey: ["setup-guide", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["tenant-setup-status", tenantId] });
      return `checklist: ${cleared} key${cleared === 1 ? "" : "s"} cleared, reads refreshed`;
    });

  const buttonClass =
    "flex-1 rounded border border-dashed border-border bg-background/60 px-1.5 py-1 " +
    "text-[10px] font-medium text-muted-foreground transition-colors " +
    "hover:border-foreground/30 hover:text-foreground " +
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border " +
    "disabled:hover:text-muted-foreground";

  return (
    <div
      // Dashed border + monospace + no brand colour: it borrows the v2 tokens
      // so it does not look broken next to the avatar, while looking like
      // nothing else in the product does.
      className="mb-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 font-mono"
      data-testid="dev-section"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="flex-1 text-left">Developer</span>
        <span className="normal-case tracking-normal opacity-60">local</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex gap-1">
            <button
              type="button"
              className={buttonClass}
              onClick={replayTour}
              disabled={busy !== null}
              title="Clear the tour's per-user seen-flag and replay it now"
            >
              <RotateCcw className="mr-1 inline h-2.5 w-2.5 align-[-1px]" />
              Tour
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={resetFirstRun}
              disabled={busy !== null}
              title="Delete this tenant's tenant_first_run row so the wizard fires again"
            >
              <RotateCcw className="mr-1 inline h-2.5 w-2.5 align-[-1px]" />
              First-run
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={resetChecklist}
              disabled={busy !== null}
              title="Clear the setup guide's dismissal state and refetch its reads"
            >
              <RotateCcw className="mr-1 inline h-2.5 w-2.5 align-[-1px]" />
              Checklist
            </button>
          </div>

          {status && (
            <p className="break-words text-[10px] leading-tight text-muted-foreground">
              {status}
            </p>
          )}

          <dl className="space-y-0.5 border-t border-dashed border-border pt-1.5 text-[10px] leading-tight">
            {readout.map(([label, value]) => (
              <div key={label} className="flex gap-1.5">
                <dt className="w-[52px] shrink-0 text-muted-foreground/70">{label}</dt>
                <dd className="min-w-0 break-words text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
