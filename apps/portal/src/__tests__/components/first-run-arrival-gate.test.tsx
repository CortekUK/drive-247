/**
 * The ARRIVAL's tenant gate — does the confetti actually reach the canary, and
 * only the canary?
 *
 * `celebrateArrival` has no gate of its own, on purpose: it is called from
 * exactly one place, inside a screen that is already northwind-only, and a
 * second copy of the gate is a second thing that can drift. That makes this
 * file the proof of the whole arrangement rather than a formality — it drives
 * the REAL wizard to completion and watches <body> for the confetti layer.
 *
 * THE POSITIVE CASE RUNS FIRST AND MUST FIND THE EFFECT. Without it, every
 * "no confetti" assertion below passes trivially on a harness that never
 * produced any — which is exactly how a gate test comes to certify nothing.
 *
 *   1. northwind                → the wizard completes and the confetti lands
 *   2. real live tenants        → no wizard, so no confetti at all
 *   3. unresolved / bogus slugs → the same, and no error
 *
 * jsdom has no Web Animations API, so it is injected here. Without it,
 * `scatterConfetti` correctly declines to paint anything and case 1 would look
 * identical to case 2.
 *
 * An AudioContext tripwire is installed alongside it — not a double, a
 * detector. The arrival is silent by request, and every case below asserts
 * nothing ever reached for audio.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FirstRunWizard } from '@/components/onboarding/first-run-wizard';
import { FIRST_RUN_QUESTIONS } from '@/lib/first-run-questions';
import { ARRIVAL_LAYER_ATTR, resetArrivalCelebration } from '@/lib/first-run-arrival';

// ── Test doubles ───────────────────────────────────────────────────────────

let currentTenant: { id: string; slug: string } | null = null;

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: currentTenant, tenantSlug: currentTenant?.slug ?? null }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ appUser: { id: 'app-user-1' } }),
}));

const stored = new Map<string, Record<string, unknown>>();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({ data: stored.get(value) ?? null, error: null }),
        }),
      }),
      upsert: async (payload: Record<string, unknown>) => {
        stored.set(String(payload.tenant_id), { id: 'row-1', ...payload });
        return { error: null };
      },
    }),
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Anything that reached for audio, across every tenant in a case. */
let audioConstructed = 0;

function installBrowserEffects() {
  (Element.prototype as unknown as { animate: unknown }).animate = () => ({
    cancel: () => {},
    set onfinish(_v: unknown) {},
    set oncancel(_v: unknown) {},
  });
  // Real Web Audio does not exist in jsdom, so an absent constructor would let
  // "silent" pass for the wrong reason. This one exists purely to be counted.
  const Tripwire = function () {
    audioConstructed += 1;
    return {};
  };
  (window as unknown as { AudioContext: unknown }).AudioContext = Tripwire;
  (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = Tripwire;
}

/** Anything that would make a noise, however it was reached. */
const madeNoise = () =>
  audioConstructed > 0 || document.querySelectorAll('audio').length > 0;

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  stored.clear();
  currentTenant = null;
  audioConstructed = 0;
  resetArrivalCelebration();
  installBrowserEffects();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  resetArrivalCelebration();
  document.querySelectorAll('[data-first-run-arrival]').forEach((n) => n.remove());
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
});

// ── Harness ────────────────────────────────────────────────────────────────

const SENTINEL = 'DASHBOARD-BEHIND-THE-WIZARD';

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderFor(tenant: { id: string; slug: string } | null): Promise<void> {
  currentTenant = tenant;
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <FirstRunWizard />
        <div>{SENTINEL}</div>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const wizardIsUp = () => !!container.querySelector('[data-first-run-wizard]');
const confettiLayers = () => document.querySelectorAll(`[${ARRIVAL_LAYER_ATTR}]`).length;
const confettiPieces = () =>
  document.querySelectorAll(`[${ARRIVAL_LAYER_ATTR}] > span`).length;

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found as HTMLButtonElement;
}

async function answerCurrentStep() {
  const choice = container.querySelector<HTMLElement>('[role="radio"], [role="checkbox"]');
  if (choice) {
    await click(choice);
    return;
  }
  const input = container.querySelector<HTMLInputElement>('input[type="text"]');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  await act(async () => {
    setter.call(input, 'Denver, CO');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Walk the whole wizard and press the final button. */
async function completeWizard() {
  for (let i = 0; i < FIRST_RUN_QUESTIONS.length - 1; i += 1) {
    await answerCurrentStep();
    await click(button('Continue'));
  }
  await answerCurrentStep();
  await click(button('Go to my dashboard'));
}

/**
 * The cases below drive the real wizard to completion and then build 220 real
 * DOM pieces in jsdom, which is slow on purpose — the burst is meant to be
 * that many. That put them close enough to vitest's 5s default that a machine
 * also running a typecheck could trip one, so the budget is stated here rather
 * than left to chance. It is headroom, not an expectation: in isolation the
 * slowest lands around 2.5s.
 */
const SLOW = { timeout: 20_000 };

// ── The three cases ────────────────────────────────────────────────────────

describe('first-run arrival — tenant gate, three cases', () => {
  it('CASE 1 — northwind gets the confetti on arrival, in silence', SLOW, async () => {
    await renderFor({ id: 'northwind-id', slug: 'northwind' });
    expect(wizardIsUp()).toBe(true);
    // Nothing before the arrival: the celebration is the LAST act, not the
    // wizard opening.
    expect(confettiLayers()).toBe(0);

    await completeWizard();

    expect(wizardIsUp()).toBe(false);
    // The dissolve still happens — the celebration rides on it, it did not
    // replace it.
    expect(document.querySelectorAll('[data-first-run-arrival]').length).toBe(1);
    expect(confettiLayers()).toBe(1);
    expect(confettiPieces()).toBeGreaterThanOrEqual(180);
    expect(madeNoise()).toBe(false);
  });

  it('CASE 2 — real live tenants get no wizard and no confetti', SLOW, async () => {
    for (const slug of [
      'goniko',
      'revtekrentals',
      'jangramrentals',
      'globalmotiontransport',
      'eastpeakrentalsllc',
      'openbayrental',
      'flowrentalsllc',
      'drive-hustle',
      'test',
      'drive-247',
    ]) {
      await renderFor({ id: `id-${slug}`, slug });
      expect(wizardIsUp(), `wizard must stay hidden for ${slug}`).toBe(false);
      expect(confettiLayers(), `no confetti for ${slug}`).toBe(0);
      expect(container.textContent, `the tree must still mount for ${slug}`).toContain(
        SENTINEL,
      );
    }
    expect(madeNoise()).toBe(false);
  });

  it('CASE 3 — an unresolved or bogus tenant gets nothing, and errors on nothing', SLOW, async () => {
    for (const tenant of [
      null,
      { id: 'x', slug: '' },
      { id: 'x', slug: 'not-a-real-tenant' },
      { id: 'x', slug: 'northwind-2' },
      { id: 'x', slug: 'Northwind' },
      { id: 'x', slug: ' northwind' },
      // The canary's two real ids, in the slug position: an id-keyed gate
      // would light up here, and this one must not.
      { id: 'x', slug: '6e5c544f-b374-451f-a662-360a634bff15' },
      { id: 'x', slug: '8e6bc88f-86d6-4468-8610-73f7c8a88f6e' },
    ]) {
      await renderFor(tenant);
      expect(wizardIsUp(), `hidden for ${JSON.stringify(tenant)}`).toBe(false);
      expect(confettiLayers()).toBe(0);
    }
    expect(madeNoise()).toBe(false);
  });

  it('celebrates a skip too — the arrival is the moment, however they got here', SLOW, async () => {
    await renderFor({ id: 'northwind-id', slug: 'northwind' });
    await click(button('Skip for now'));

    expect(wizardIsUp()).toBe(false);
    expect(confettiLayers()).toBe(1);
  });

  it('fires once even if the final button is clicked twice', SLOW, async () => {
    await renderFor({ id: 'northwind-id', slug: 'northwind' });
    for (let i = 0; i < FIRST_RUN_QUESTIONS.length - 1; i += 1) {
      await answerCurrentStep();
      await click(button('Continue'));
    }
    await answerCurrentStep();
    const finalButton = button('Go to my dashboard');
    await click(finalButton);
    // The wizard has unmounted; click the detached node again anyway, which is
    // the closest a test gets to a double-click landing across the unmount.
    await click(finalButton);

    expect(confettiLayers()).toBe(1);
    expect(madeNoise()).toBe(false);
  });
});
