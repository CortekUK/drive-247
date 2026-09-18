/**
 * MAJOR 5 — a hard-blocked tenant must not be trapped behind ONBOARDING on the
 * one route that can take their money.
 *
 * `/subscription` and `/settings` are deliberately exempt from the paywall
 * (`isSubscriptionPage`), so a blocked tenant always has somewhere to pay. But
 * `showGate` — the gate's own, route-dependent signal — was also the ONLY
 * suppression signal handed to the four full-screen prompts:
 *
 *     <FeedbackForcePrompt suppressed={showGate} />
 *     <WelcomePackPrompt   suppressed={showGate} />
 *     <FirstRunWizard      suppressed={showGate} />
 *     <FirstRentalTour     suppressed={showGate} />
 *
 * On the exempt routes `showGate` is false by construction, so the first-run
 * wizard and friends were NOT suppressed and could own the screen. A
 * hard-blocked operator who had not finished onboarding was therefore asked
 * onboarding questions instead of being allowed to pay.
 *
 * The fix is a second, ROUTE-INDEPENDENT signal (`gateWouldBlock`) for those four
 * prompts, while `showGate` keeps the route exemption for the gate dialog itself.
 *
 * Both halves are pinned here:
 *   - the real expressions are LIFTED out of `(dashboard)/layout.tsx` and
 *     executed, so these are the shipped booleans rather than a paraphrase;
 *   - source assertions pin the wiring — which signal reaches which surface —
 *     because a correct `gateWouldBlock` passed to nothing would still leave the
 *     trap in place.
 *
 * It also closes the two coverage gaps the simulation left open: that the pay
 * link is actually REACHABLE on the exempt routes (nothing covers it, and the
 * phone bar is mounted there too), and — in the sibling suite
 * `use-tenant-subscription-grace-window.test.tsx` — the 14-day grace leg.
 */

import { describe, it, expect } from 'vitest';

import {
  codeOnly,
  compileExpression,
  liftDeclaration,
  readPortalSource,
} from '../helpers/edge-source';

const RAW = readPortalSource('app/(dashboard)/layout.tsx');
const SRC = codeOnly(RAW);

/* ── the real expressions, executed ────────────────────────────────────────
   Lifted in file order: they are `const`s inside the component body, so the
   later ones read the earlier ones and the order is load-bearing. */
const LIFTED = [
  'isSubscriptionPage',
  'hasActivePlans',
  'gateSuppressed',
  'plansResolved',
  'plansNeededForGate',
  'gateStateKnown',
  'expiredGateApplies',
  'setupGateApplies',
  'showExpiredGate',
  'showSetupGate',
  'gateOpen',
  'gateWouldOpen',
  'nothingToBuy',
  'showGate',
  'gateWouldBlock',
  'holdForGateState',
] as const;

const PARAMS = [
  'pathname',
  'plans',
  'subscriptionGateDisabled',
  'tenant',
  'plansSuccess',
  'plansErrored',
  'isSubscribed',
  'hasExpiredSubscription',
  'tenantLoading',
  'subscriptionResolved',
  'gateLatched',
  'hasPaintedOnce',
] as const;

type Inputs = {
  pathname: string;
  plans: Array<{ id: string }> | undefined;
  subscriptionGateDisabled: boolean;
  tenant: { id: string; subscription_gate_disabled?: boolean } | null;
  plansSuccess: boolean;
  plansErrored: boolean;
  isSubscribed: boolean;
  hasExpiredSubscription: boolean;
  tenantLoading: boolean;
  subscriptionResolved: boolean;
  gateLatched: boolean;
  hasPaintedOnce: boolean;
};

type Gate = {
  showGate: boolean;
  gateWouldBlock: boolean;
  gateOpen: boolean;
  gateWouldOpen: boolean;
  showSetupGate: boolean;
  showExpiredGate: boolean;
  gateStateKnown: boolean;
  nothingToBuy: boolean;
  holdForGateState: boolean;
  isSubscriptionPage: boolean;
};

const evaluate = compileExpression<(...args: unknown[]) => Gate>(
  [...PARAMS],
  LIFTED.map((name) => liftDeclaration(RAW, name, { tsx: true })),
  `({
     showGate, gateWouldBlock, gateOpen, gateWouldOpen, showSetupGate,
     showExpiredGate, gateStateKnown, nothingToBuy, holdForGateState,
     isSubscriptionPage: !!isSubscriptionPage,
   })`,
);

/** A tenant whose grace window has closed: hard-blocked, nothing suppressed. */
const HARD_BLOCKED: Inputs = {
  pathname: '/',
  plans: [{ id: 'plan-1' }],
  subscriptionGateDisabled: false,
  tenant: { id: 'tenant-1' },
  plansSuccess: true,
  plansErrored: false,
  isSubscribed: false,
  hasExpiredSubscription: true,
  tenantLoading: false,
  subscriptionResolved: true,
  gateLatched: false,
  hasPaintedOnce: true,
};

/** Never subscribed, with a plan to buy: the soft "Finish Setup" gate. */
const NEVER_SUBSCRIBED: Inputs = {
  ...HARD_BLOCKED,
  isSubscribed: false,
  hasExpiredSubscription: false,
};

/** Paying, healthy. */
const HEALTHY: Inputs = {
  ...HARD_BLOCKED,
  isSubscribed: true,
  hasExpiredSubscription: false,
};

const gate = (over: Partial<Inputs> = {}): Gate => {
  const i: Inputs = { ...HARD_BLOCKED, ...over };
  return evaluate(...PARAMS.map((p) => i[p]));
};

/* Every route the paywall deliberately leaves reachable, so a blocked tenant
   always has somewhere to pay. `/dev` is development-only and is covered by its
   own suite. */
const EXEMPT = ['/subscription', '/credits', '/settings', '/settings/billing'];

describe('the four onboarding prompts are suppressed on the exempt routes', () => {
  it.each(EXEMPT)('hard-blocked tenant on %s: gateWouldBlock, but no gate dialog', (pathname) => {
    const g = gate({ pathname });
    expect(g.isSubscriptionPage).toBe(true);
    // The trap: false here means the first-run wizard can own the one screen
    // that takes money.
    expect(g.gateWouldBlock).toBe(true);
    // ...and the gate dialog itself must STILL stay off the exempt route.
    expect(g.showGate).toBe(false);
    expect(g.gateOpen).toBe(false);
  });

  it.each(EXEMPT)('never-subscribed tenant on %s is suppressed too', (pathname) => {
    const g = gate({ ...NEVER_SUBSCRIBED, pathname });
    expect(g.gateWouldBlock).toBe(true);
    expect(g.showGate).toBe(false);
  });

  it('a hard-blocked tenant on a normal route is still suppressed', () => {
    const g = gate({ pathname: '/rentals' });
    expect(g.gateWouldBlock).toBe(true);
    expect(g.showGate).toBe(true);
  });

  it.each(['/', '/rentals', ...EXEMPT])('a healthy subscribed tenant is never suppressed on %s', (pathname) => {
    const g = gate({ ...HEALTHY, pathname });
    expect(g.gateWouldBlock).toBe(false);
    expect(g.showGate).toBe(false);
  });

  it('neither signal survives a kill switch, on any route', () => {
    for (const pathname of ['/', '/subscription']) {
      const globalOff = gate({ pathname, subscriptionGateDisabled: true });
      expect(globalOff.gateWouldBlock).toBe(false);
      expect(globalOff.showGate).toBe(false);

      const tenantOff = gate({
        pathname,
        tenant: { id: 'tenant-1', subscription_gate_disabled: true },
      });
      expect(tenantOff.gateWouldBlock).toBe(false);
      expect(tenantOff.showGate).toBe(false);
    }
  });

  it('a never-subscribed tenant with nothing to buy is not suppressed', () => {
    // plansSuccess with zero rows: there is no product to sell them, so the
    // soft gate never opens and onboarding must not be suppressed either.
    const g = gate({ ...NEVER_SUBSCRIBED, plans: [], pathname: '/subscription' });
    expect(g.nothingToBuy).toBe(true);
    expect(g.gateWouldOpen).toBe(false);
    expect(g.gateWouldBlock).toBe(false);
  });

  it('an unknown billing state suppresses nothing (the skeleton is held instead)', () => {
    const g = gate({ pathname: '/', subscriptionResolved: false, hasPaintedOnce: false });
    expect(g.gateStateKnown).toBe(false);
    expect(g.gateWouldBlock).toBe(false);
    expect(g.holdForGateState).toBe(true);
  });

  it('a latched gate keeps the prompts suppressed after navigating to /subscription', () => {
    // The latch is set from `gateOpen` on a normal route; walking to an exempt
    // route must not hand the screen back to onboarding.
    const g = gate({ pathname: '/subscription', gateLatched: true, subscriptionResolved: false });
    expect(g.gateWouldBlock).toBe(true);
    expect(g.showGate).toBe(false);
  });
});

describe('the gate, the skeleton and the latch are unchanged', () => {
  it('showSetupGate / showExpiredGate still carry the route exemption', () => {
    const blocked = gate({ pathname: '/subscription' });
    expect(blocked.showExpiredGate).toBe(false);
    const setup = gate({ ...NEVER_SUBSCRIBED, pathname: '/settings' });
    expect(setup.showSetupGate).toBe(false);

    const onDashboard = gate({ pathname: '/' });
    expect(onDashboard.showExpiredGate).toBe(true);
    expect(gate({ ...NEVER_SUBSCRIBED, pathname: '/' }).showSetupGate).toBe(true);
  });

  it.each(EXEMPT)('an exempt route never holds the skeleton (%s)', (pathname) => {
    const g = gate({ pathname, subscriptionResolved: false, hasPaintedOnce: false });
    expect(g.holdForGateState).toBe(false);
  });

  it('a normal route still holds the skeleton until the billing state is known', () => {
    expect(
      gate({ pathname: '/', subscriptionResolved: false, hasPaintedOnce: false }).holdForGateState,
    ).toBe(true);
    // ...and only for the FIRST paint.
    expect(
      gate({ pathname: '/', subscriptionResolved: false, hasPaintedOnce: true }).holdForGateState,
    ).toBe(false);
  });
});

describe('layout wiring: which signal reaches which surface', () => {
  const tagFor = (component: string) => {
    const i = SRC.indexOf(`<${component}`);
    expect(i, `${component} should be mounted in (dashboard)/layout.tsx`).toBeGreaterThan(-1);
    return SRC.slice(i, SRC.indexOf('/>', i) + 2);
  };

  it.each([
    'FeedbackForcePrompt',
    'WelcomePackPrompt',
    'FirstRunWizard',
    'FirstRentalTour',
  ])('%s takes the route-independent signal', (component) => {
    expect(tagFor(component)).toContain('suppressed={gateWouldBlock}');
  });

  it('the gate dialog still takes the route-dependent one', () => {
    expect(SRC).toMatch(/<SubscriptionGateDialog\s+open=\{showGate\}/);
  });

  it('gateWouldBlock is route-independent: no isSubscriptionPage in its chain', () => {
    for (const name of ['gateWouldBlock', 'gateWouldOpen', 'setupGateApplies', 'expiredGateApplies']) {
      expect(codeOnly(liftDeclaration(RAW, name, { tsx: true }))).not.toContain('isSubscriptionPage');
    }
    // ...while the gate's own signals keep it.
    for (const name of ['showGate', 'showSetupGate', 'showExpiredGate', 'holdForGateState']) {
      expect(codeOnly(liftDeclaration(RAW, name, { tsx: true }))).toContain('isSubscriptionPage');
    }
  });

  it('the latch is still driven by the route-dependent gateOpen', () => {
    // Latching on the route-INDEPENDENT signal would change when the gate is
    // shown, which this fix deliberately does not touch.
    expect(SRC).toMatch(/if \(gateOpen\) setGateLatched\(true\)/);
  });
});

describe('the pay link is reachable on the exempt routes', () => {
  it('the phone dunning bar is mounted in flow, on every route', () => {
    expect(SRC).toContain(
      'import { PaymentDueBar } from "@/components/subscription/payment-due-bar";',
    );
    const mount = SRC.indexOf('<PaymentDueBar />');
    expect(mount, 'PaymentDueBar should be mounted in (dashboard)/layout.tsx').toBeGreaterThan(-1);

    // Inside <Inset>, next to the other in-flow banners and above <main> — NOT
    // `position: fixed`, so it cannot fight SystemAnnouncementBanner's offsets.
    const inset = SRC.indexOf('<Inset');
    const main = SRC.indexOf('<main');
    expect(mount).toBeGreaterThan(inset);
    expect(mount).toBeLessThan(main);
    const banners = SRC.indexOf('<AppBannerStack scope="app" />');
    expect(Math.abs(SRC.indexOf('<MaintenanceBanner />') - mount)).toBeLessThan(400);
    expect(banners).toBeGreaterThan(-1);

    // Route-independent: mounted with no `isSubscriptionPage` guard anywhere in
    // the JSX around it, which is what makes it reachable on /subscription.
    const around = SRC.slice(Math.max(0, mount - 200), mount + 200);
    expect(around).not.toContain('isSubscriptionPage');
    expect(around).not.toContain('showGate');
    // And no props at all: the bar reads its own state, so no route can gate it.
    expect(SRC).not.toMatch(/<PaymentDueBar\s+[a-zA-Z]/);
  });

  it('the bar itself is route-blind', () => {
    const barSrc = codeOnly(readPortalSource('components/subscription/payment-due-bar.tsx'));
    expect(barSrc).not.toContain('usePathname');
    expect(barSrc).not.toContain('isSubscriptionPage');
  });

  it('/subscription still hands a past-due tenant the hosted invoice', () => {
    const page = codeOnly(readPortalSource('app/(dashboard)/subscription/page.tsx'));
    expect(page).toContain('href={outstandingInvoiceUrl}');
  });

  it('/settings does too', () => {
    // Owned by another session; asserted read-only so the two surfaces cannot
    // silently diverge on the one thing they both exist to offer.
    const settings = codeOnly(readPortalSource('components/settings/subscription-settings.tsx'));
    expect(settings).toContain('href={outstandingInvoiceUrl}');
  });
});
