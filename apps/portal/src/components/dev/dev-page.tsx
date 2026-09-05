'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { Compass, Loader2, Sparkles, Wrench } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui-v2/card';
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
 * Exactly two abilities, by request, and nothing else: no readouts, no seed
 * data, no flag toggles, no environment info. The layout is a list of
 * sections so a third ability has somewhere to go later without this file
 * being restructured; today there is one section holding two actions.
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
   * "Start as a first-time operator" — everything "first time" means, reset in
   * one go, then a FULL reload of the dashboard. The order is deliberate:
   *
   *   1. the database first, because it is the step that can be refused. If
   *      RLS blocks the delete nothing local is touched and the failure is
   *      shown loudly — a reset that clears the tour but leaves the wizard
   *      dark would look like a bug in the wizard;
   *   2. then the tour's per-user seen flags, which re-arms its AUTOSTART;
   *   3. then the checklist's dismissal state, so it shows as on day one;
   *   4. then `window.location.assign('/')` rather than a client-side
   *      navigation. A brand-new operator arrives on a cold page. A soft
   *      navigation would carry over the wizard's component state (it stays
   *      mounted in the dashboard layout, so its step and answers survive
   *      `shouldShow` flipping), the tour's one-shot autostart ref, and every
   *      cached query — all of which would make the second run subtly unlike
   *      the first. A hard load makes the sequence the real one: the wizard's
   *      query settles empty and it mounts fresh; finishing it writes the row,
   *      `wizardPending` goes false, and the tour's autostart gate — now
   *      unseen, on `/`, on the canary — fires after its short anchor poll.
   */
  const startAsFirstTimeOperator = async (): Promise<string> => {
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
    window.location.assign('/');
    return (
      `Reset done — first-run record ${result.deleted > 0 ? 'cleared' : 'was already clear'}, ` +
      `${tourFlags} tour flag${tourFlags === 1 ? '' : 's'} and ${checklistKeys} checklist ` +
      `key${checklistKeys === 1 ? '' : 's'} cleared. Taking you to the dashboard…`
    );
  };

  /** "Start the quick tour" — replay, right here, right now. Nothing reset. */
  const startQuickTour = async (): Promise<string> => {
    replayTour();
    return 'Tour started. If nothing appeared, open the navigation sidebar and try again.';
  };

  const sections: DevSectionSpec[] = [
    {
      id: 'onboarding',
      title: 'Onboarding',
      actions: [
        {
          id: 'first-time',
          title: 'Start as a first-time operator',
          description:
            'Clears the first-run record, the tour’s seen flag and the setup checklist’s ' +
            'dismissals, then reloads the dashboard the way a brand-new operator meets it: ' +
            'the wizard first, the three-stop tour after it, the checklist showing.',
          label: 'Start as a first-time operator',
          icon: Sparkles,
          run: startAsFirstTimeOperator,
        },
        {
          id: 'quick-tour',
          title: 'Start the quick tour',
          description:
            'Replays the three-stop first-rental tour right here, in this tab. Nothing is reset.',
          label: 'Start the quick tour',
          icon: Compass,
          run: startQuickTour,
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
    <div data-testid="dev-page" className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-2">
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
        <p className="text-sm text-muted-foreground">
          Tools for replaying the first-run experience on this machine. Not part of any
          production build.
        </p>
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
          <div className="grid gap-4 sm:grid-cols-2">
            {section.actions.map((action) => {
              const Icon = action.icon;
              const isBusy = busy === action.id;
              return (
                <Card key={action.id} size="sm" data-dev-action={action.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="size-4 text-primary" />
                      {action.title}
                    </CardTitle>
                    <CardDescription>{action.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      type="button"
                      onClick={() => void run(action)}
                      disabled={busy !== null}
                      aria-busy={isBusy}
                    >
                      {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Icon />}
                      {action.label}
                    </Button>
                  </CardContent>
                </Card>
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
              ? 'rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive'
              : 'text-sm text-muted-foreground'
          }
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
