'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { Compass, Loader2, Rocket, Sparkles, Wrench } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { EmptyStatePreview } from '@/components/dev/empty-state-preview';
import { MessagesPreview } from '@/components/dev/messages-preview';
import { BillingPreview } from '@/components/dev/billing-preview';
import { PaymentPlanSimulator } from '@/components/dev/payment-plan-simulator';
import { E2eLiveRunner } from '@/components/dev/e2e-live-runner';
import { AutoExtendShadow } from '@/components/dev/auto-extend-shadow';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { NORTHWIND } from '@/lib/v2';
import {
  clearChecklistState,
  clearTourSeenFlags,
  replayTour,
  resetFirstRunRow,
  type FirstRunClient,
} from '@/lib/dev-actions';

/**
 * The developer page — `/dev`, local only, northwind only.
 *
 * Exactly three abilities, by request, and nothing else: no readouts, no seed
 * data, no flag toggles, no environment info. The layout is a list of
 * sections so a further ability has somewhere to go later without this file
 * being restructured; today there is one section holding three actions.
 *
 * ── ONE GATE, AND WHY THE OTHER TWO WENT (Sep 20 2026) ────────────────────
 * This page used to carry four gates. Two of them — a BUILD gate
 * (`process.env.NODE_ENV === "development"` in the route file, which folded
 * this component out of a production bundle) and a HOST gate (the browser had
 * to be on localhost) — are exactly what kept the developer tool off the live
 * portal, which is what was asked for. Both are gone, deliberately.
 *
 * What that costs, written down rather than left to be rediscovered: this
 * component and everything it imports now ship in the production bundle as
 * reachable code. So here is the whole blast radius — every path on this page
 * that writes anything, and nothing else does:
 *
 *   1. A `delete` on `tenant_first_run` scoped to the OPEN TENANT'S OWN id — a
 *      table that does not exist in production at all, so it answers "absent".
 *   2. Browser storage (localStorage / sessionStorage) on the operator's own
 *      machine: the reset actions and the empty-state, messages and billing
 *      previews.
 *   3. LIVE TEST RUNS (`e2e-live-runner.tsx`, Sep 26 2026) — the one path that
 *      writes REAL ROWS, and the reason this paragraph was rewritten. It used
 *      to say the first-run delete was the only database write; that stopped
 *      being true when this section arrived.
 *
 *      The browser itself still inserts, updates and deletes nothing. It sends
 *      the `e2e-runner` edge function a GET and a `list` (no writes), SELECTs
 *      `dev_sim_runs` / `dev_sim_run_steps` and a fixture rental's number for
 *      this tenant, and asks for each scenario's `preview` (no writes: the
 *      runner hands that path a client whose writes throw, G7). Only after
 *      the operator confirms beside "This writes test rows to northwind in
 *      Stripe TEST mode" does it send `start`, then `advance` / `continue`,
 *      and on request `abort` or `close`. The RUNNER then writes — on whatever
 *      project this portal talks to, which for the live portal is the
 *      PRODUCTION database: per run, one E2E-FIXTURE customer (an
 *      @e2e.drive247.test address, no phone) and one fixture rental on
 *      northwind, registered in `dev_sim_fixtures`; that rental's booking
 *      charges, and the payments, refunds, extensions, plan rows and reminders
 *      the real edge functions create for it; one `dev_sim_runs` row and one
 *      `dev_sim_run_steps` row per step; and Stripe TEST-mode customers, cards,
 *      charges and refunds on northwind's test account.
 *
 *      What bounds it, outermost first:
 *        - this page's slug gate (below), and the section's own second check,
 *          so no other tenant renders it or sends a single probe;
 *        - the section offers NOTHING to click unless the function answers
 *          (it is deployed, switched on and lets this user in), lists its
 *          scenarios with every environment check passing, and `dev_sim_runs`
 *          answers its GET;
 *        - a preview in which the runner refuses the scenario, the tenant's
 *          settings differ from what the expected values assume, a check
 *          fails, or the preview tried to write, cannot be confirmed; and
 *          only scenarios the catalogue marks live-runnable get a Run button;
 *        - AUTHORITATIVE, and the RUNNER's and the database's, not this
 *          page's (supabase/functions/e2e-runner/index.ts G0–G11, and
 *          supabase/migrations/20260926120300_dev_sim_runs.sql): a kill switch
 *          (E2E_RUNNER_ENABLED=northwind); callers limited to a super admin or
 *          northwind's head admin; the tenant re-read by slug on every request
 *          and refused unless northwind, active and stripe_mode 'test', again
 *          in SQL on every write (e2e_fixture_guard); only sk_test_/rk_test_
 *          keys; writes only to the run's registered fixture; time moved only
 *          by e2e_shift_fixture on that fixture; cron work only through the
 *          `sandbox-*` clones with only_rental_id = the fixture, never the live
 *          jobs (6, 4, 32, 33, 54, 55), and the fixture parked between calls
 *          so those jobs never select it; one request per run (a lease). The
 *          page cannot enforce any of that; it can only refuse to offer a run
 *          the runner does not claim is safe. The runner does NOT require the
 *          preview or the confirm sentence before `start` — that order is
 *          this page's.
 *
 *      Until the function is deployed and switched on and the migration
 *      applied, this path is inert: the section says which piece is missing
 *      and has no buttons.
 *
 *   Add a further writing action to this page and this list must grow with it.
 *
 * The payment plan simulator (Sep 25 2026) adds nothing to the list: it runs
 * the plan engine against an in-memory store in the tab and a simulated card,
 * imports no Supabase client and calls no edge function. It writes nothing
 * anywhere; its only output is a JSON file the tester chooses to download.
 *
 * TENANT  `tenant.slug === NORTHWIND`, and nothing else, decided below.
 *
 *   NOT `useIsLean()`, which is what the localhost version asked. Lean is now
 *   `slug ∈ LEAN_TENANTS || tenants.portal_experience = 'v2'`, and in
 *   production that column is already `'v2'` for `nasir` and `squad` as well
 *   as `northwind`, with every self-serve signup landing on v2 from now on. On
 *   localhost the difference was invisible; on live it would have handed a
 *   developer tool to real operators.
 *
 *   Keyed on the SLUG and never the id: `northwind` is 6e5c544f-… in
 *   production and 8e6bc88f-… on the staging branch, so an id-keyed gate
 *   silently resolves wrong in one of them with no error and no failed build.
 *   The slug read is `tenant.slug`, the row that actually came back, not
 *   `tenantSlug`, which TenantContext derives from the hostname in an effect
 *   before any lookup has run. It is null on the first tick of every load, so
 *   the page renders nothing until the row resolves — and a host that spells
 *   the canary in an environment where it does not exist gets `notFound()`.
 *
 * Every refused case renders the not-found page rather than an empty one, so
 * "nothing here" is a deliberate answer and not a blank screen.
 *
 * ── PERMISSIONS ────────────────────────────────────────────────────────────
 * `/dev` is mapped in `lib/permissions.ts` to a tab key no manager can hold.
 * `canAccessRoute` treats an UNMAPPED route as allowed, so without that entry
 * a manager-role user on the canary would be granted this page silently.
 */

/**
 * Where the demo signup journey lives — the public landing page through plan
 * choice, signup, verification and payment — built in apps/web at
 * `/demo-signup` (dev-only there too, same as this page). The base URL is
 * configurable so this is never permanently hardcoded to localhost; the
 * fallback is apps/web's dev port in THIS worktree — booking 4001, portal
 * 4002, web 4003, admin 4004, bonzah 4005, never 3000–3005.
 */
const DEMO_SIGNUP_URL = `${process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:4003'}/demo-signup`;

interface DevAction {
  id: string;
  title: string;
  description: string;
  label: string;
  icon: typeof Sparkles;
  /** Resolves to a status line, or throws to show an error line. */
  run: () => Promise<string>;
}

interface DevSectionSpec {
  id: string;
  title: string;
  actions: DevAction[];
}

type Status = { tone: 'ok' | 'error'; text: string };

export function DevPageBody() {
  const { tenant, loading: tenantLoading } = useTenant();

  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  // Hooks above this line, always. Everything below may return early.

  // Still resolving — TenantContext has not answered yet. Tolerated quietly;
  // nothing is decided on an unknown.
  if (!tenant && tenantLoading) return null;

  // THE GATE — the tenant. A lookup that finished with no row (a bogus host,
  // or a host that merely spells the canary somewhere it does not exist) is a
  // refusal, not a wait.
  if (!tenant || tenant.slug !== NORTHWIND) notFound();

  const tenantId = tenant.id;

  /**
   * Everything "first time" means, reset in one go: the database row, then
   * the tour's per-user seen flags, then the checklist's dismissal state.
   * Shared by both actions below that promise a fresh arrival — "as a
   * first-time operator" reloading straight into this dashboard, and "from
   * the landing page" arriving here later via the demo signup journey —
   * so which local state counts as "already seen" is written down exactly
   * once. Neither caller navigates until this resolves; each does its own
   * navigation afterwards, because where they send the operator differs.
   *
   * The order is deliberate:
   *   1. the database first, because it is the step that can be refused. If
   *      RLS blocks the delete nothing local is touched and the failure is
   *      shown loudly — a reset that clears the tour but leaves the wizard
   *      dark would look like a bug in the wizard;
   *   2. then the tour's per-user seen flags, which re-arms its AUTOSTART;
   *   3. then the checklist's dismissal state, so it shows as on day one.
   */
  const resetOnboardingState = async (): Promise<{
    deleted: number;
    tourFlags: number;
    checklistKeys: number;
    absent: boolean;
  }> => {
    const result = await resetFirstRunRow(supabase as unknown as FirstRunClient, tenantId);
    // `=== false`, not `!result.ok`: portal compiles with strictNullChecks off,
    // and under that flag TypeScript narrows a discriminated union only on an
    // equality check, never on truthiness — `result.reason` would not resolve.
    if (result.ok === false) {
      throw new Error(
        result.reason === 'blocked'
          ? result.message
          : `Could not clear the first-run record: ${result.message}. Nothing was reset.`,
      );
    }
    const tourFlags = clearTourSeenFlags();
    const checklistKeys = clearChecklistState(tenantId);
    return {
      deleted: result.deleted,
      tourFlags,
      checklistKeys,
      absent: result.absent === true,
    };
  };

  /**
   * "Start as a first-time operator" — the reset above, then a FULL reload of
   * the dashboard. `window.location.assign('/')` rather than a client-side
   * navigation: a brand-new operator arrives on a cold page. A soft
   * navigation would carry over the wizard's component state (it stays
   * mounted in the dashboard layout, so its step and answers survive
   * `shouldShow` flipping), the tour's one-shot autostart ref, and every
   * cached query — all of which would make the second run subtly unlike
   * the first. A hard load makes the sequence the real one: the wizard's
   * query settles empty and it mounts fresh; finishing it writes the row,
   * `wizardPending` goes false, and the tour's autostart gate — now
   * unseen, on `/`, on the canary — fires after its short anchor poll.
   */
  const startAsFirstTimeOperator = async (): Promise<string> => {
    const { deleted, tourFlags, checklistKeys, absent } = await resetOnboardingState();
    window.location.assign('/');
    return (
      `Reset done — first-run record ${
        absent ? 'not tracked on this database' : deleted > 0 ? 'cleared' : 'was already clear'
      }, ${tourFlags} tour flag${tourFlags === 1 ? '' : 's'} and ${checklistKeys} checklist ` +
      `key${checklistKeys === 1 ? '' : 's'} cleared. Taking you to the dashboard…`
    );
  };

  /** "Start the quick tour" — replay, right here, right now. Nothing reset. */
  const startQuickTour = async (): Promise<string> => {
    replayTour();
    return 'Tour started. If nothing appeared, open the navigation sidebar and try again.';
  };

  /**
   * "Start from the landing page" — the same reset as above, awaited so it
   * COMPLETES before we ever navigate (racing it would land the operator back
   * in the portal with the wizard never re-armed), then off to apps/web's
   * demo signup journey rather than straight to the dashboard. That journey
   * ends by handing the browser back to the portal, where the now-armed
   * wizard and tour pick up exactly as they would for any brand-new operator.
   */
  const startFromLandingPage = async (): Promise<string> => {
    await resetOnboardingState();
    window.location.assign(DEMO_SIGNUP_URL);
    return 'reset ok — redirecting to landing page';
  };

  const sections: DevSectionSpec[] = [
    {
      id: 'onboarding',
      title: 'Onboarding',
      actions: [
        {
          id: 'first-time',
          title: 'First-time operator',
          description: 'Reset first-run + tour + checklist, reload dashboard.',
          label: 'Run',
          icon: Sparkles,
          run: startAsFirstTimeOperator,
        },
        {
          id: 'quick-tour',
          title: 'Quick tour',
          description: 'Replay the tour in this tab. No reset.',
          label: 'Run',
          icon: Compass,
          run: startQuickTour,
        },
        {
          id: 'landing-page',
          title: 'Full signup journey',
          description: 'Reset, then landing page → plan → signup → OTP → pay.',
          label: 'Run',
          icon: Rocket,
          run: startFromLandingPage,
        },
      ],
    },
  ];

  const run = async (action: DevAction) => {
    setBusy(action.id);
    setStatus(null);
    try {
      setStatus({ tone: 'ok', text: await action.run() });
    } catch (err) {
      setStatus({
        tone: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="dev-page" className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-2">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
            <Wrench className="size-4" />
          </span>
          <h1 className="font-heading text-2xl font-medium leading-snug text-foreground">
            Developer
          </h1>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            local only
          </span>
        </div>
      </header>

      {/* Directly under the header, ABOVE the actions.
          It used to sit after the Empty States section, hundreds of pixels
          below the fold. Clicking Run at the top therefore looked like it did
          nothing — the failure was reported off screen, which is how a database
          error that had a perfectly clear message read as a dead button. An
          action's outcome belongs next to the action. */}
      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          data-dev-status={status.tone}
          className={
            status.tone === 'error'
              ? 'rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive'
              : 'rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground'
          }
        >
          {status.text}
        </p>
      )}

      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`dev-section-${section.id}`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`dev-section-${section.id}`}
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {section.title}
          </h2>
          {/* One row per action, not a card each. This is an internal console:
              the name, one line of what it does, and the button — dense enough
              to take in at a glance instead of read. */}
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {section.actions.map((action) => {
              const Icon = action.icon;
              const isBusy = busy === action.id;
              return (
                <div
                  key={action.id}
                  data-dev-action={action.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] leading-tight text-foreground">
                      {action.title}
                    </p>
                    <p className="truncate text-xs leading-tight text-muted-foreground">
                      {action.description}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 font-mono text-xs"
                    onClick={() => void run(action)}
                    disabled={busy !== null}
                    aria-busy={isBusy}
                  >
                    {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {action.label}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <EmptyStatePreview />

      <MessagesPreview />
      <BillingPreview />
      <PaymentPlanSimulator />
      <E2eLiveRunner />
      <AutoExtendShadow />
    </div>
  );
}
