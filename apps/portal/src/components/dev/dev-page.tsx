'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { Compass, Loader2, Rocket, Sparkles, Wrench } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { EmptyStatePreview } from '@/components/dev/empty-state-preview';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { isLeanTenant } from '@/lib/lean-areas';
import {
  clearChecklistState,
  clearTourSeenFlags,
  isLocalhostHost,
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
 * ── THE GATES, and where each one lives ───────────────────────────────────
 * Four, guarding four different failures. Only the last three are here.
 *
 * 1. BUILD   `process.env.NODE_ENV === "development"`, in the route file
 *    (`app/(dashboard)/dev/page.tsx`). Next substitutes the literal at build
 *    time, so a production build folds the check to a constant and this
 *    whole component — referenced from nowhere else — is tree-shaken out.
 *
 * 2. ROUTE   the same check in the route file calls `notFound()`, so a typed
 *    URL on production has nothing there. Note that under the portal's
 *    `(dashboard)` layout this returns HTTP 200 — the layout streams before
 *    the page resolves — so the status code proves nothing; only the rendered
 *    path does, which is what the gate test asserts.
 *
 * 3. HOST    the browser must be on localhost. Resolved in an effect rather
 *    than read inline so the server render and the first client render agree
 *    and React does not tear the tree down over a hydration mismatch. Until
 *    it resolves, nothing renders.
 *
 * 4. TENANT  `isLeanTenant(tenant.slug)` — the northwind canary, keyed on the
 *    SLUG and never the id: `northwind` is 6e5c544f-… in production and
 *    8e6bc88f-… on the staging branch, so an id-keyed gate silently resolves
 *    wrong in one of them with no error and no failed build. The slug read is
 *    `tenant.slug`, the row that actually came back, not `tenantSlug`, which
 *    TenantContext derives from the hostname in an effect before any lookup
 *    has run. Both are null on the first tick of every load, so the page
 *    renders nothing until the row resolves — and a host that spells the
 *    canary in an environment where it does not exist gets `notFound()`.
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

  // GATE 3 — the hostname. `null` until the effect has run.
  const [onLocalhost, setOnLocalhost] = useState<boolean | null>(null);
  useEffect(() => {
    setOnLocalhost(isLocalhostHost(window.location.hostname));
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  // Hooks above this line, always. Everything below may return early.

  // Still resolving — the hostname effect has not run, or TenantContext has
  // not answered yet. Tolerated quietly; nothing is decided on an unknown.
  if (onLocalhost === null || (!tenant && tenantLoading)) return null;

  // GATE 4 — the tenant. A lookup that finished with no row (a bogus host, or
  // a host that merely spells the canary somewhere it does not exist) is a
  // refusal, not a wait.
  if (!tenant || !isLeanTenant(tenant.slug)) notFound();
  // GATE 3, decided.
  if (!onLocalhost) notFound();

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
    return { deleted: result.deleted, tourFlags, checklistKeys };
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
    const { deleted, tourFlags, checklistKeys } = await resetOnboardingState();
    window.location.assign('/');
    return (
      `Reset done — first-run record ${deleted > 0 ? 'cleared' : 'was already clear'}, ` +
      `${tourFlags} tour flag${tourFlags === 1 ? '' : 's'} and ${checklistKeys} checklist ` +
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

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          data-dev-status={status.tone}
          className={
            status.tone === 'error'
              ? 'rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive'
              : 'px-1 font-mono text-xs text-muted-foreground'
          }
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
