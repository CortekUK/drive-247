/**
 * The first-run wizard's tenant gate — THREE cases, not two, plus "exactly once".
 *
 * Two cases cannot tell "the gate refused" apart from "the tenant lookup came
 * back empty": both render nothing and both look like a pass. So every case
 * below renders a sentinel next to the wizard and asserts the sentinel is
 * there — proving the tree mounted and the WIZARD was filtered, rather than the
 * whole render having failed and trivially "hidden" everything.
 *
 *   1. `northwind`            → the wizard SHOWS
 *   2. a real live tenant     → the wizard does NOT show. This is the outage
 *                               case and it matters most: this is a
 *                               full-screen, non-dismissible surface, and the
 *                               other 57 tenants have never had it.
 *   3. an unresolved / bogus  → nothing shows, and nothing errors.
 *
 * This RENDERS the component. Status codes prove nothing — `notFound()` under
 * the portal's `(dashboard)` group returns 200 because the layout streams
 * before the page resolves — and SSR output proves nothing either, since
 * TenantContext resolves the slug client-side from `window.location.hostname`
 * in a `useEffect`, so server HTML is byte-identical for every tenant. Only
 * executing the client component against a known tenant can separate the cases.
 *
 * HARNESS: `react-dom/client` + `act`, matching the other gate tests here
 * (`integrations-board-cmd-gate.test.tsx`, `connect-stripe-required-dialog`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FirstRunWizard } from '@/components/onboarding/first-run-wizard';
import { FIRST_RUN_QUESTIONS } from '@/lib/first-run-questions';

// ── Test doubles ───────────────────────────────────────────────────────────

let currentTenant: { id: string; slug: string } | null = null;

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: currentTenant, tenantSlug: currentTenant?.slug ?? null }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ appUser: { id: 'app-user-1' } }),
}));

/** tenant_id → the persisted first-run row. The "seen it" flag, in memory. */
const stored = new Map<string, Record<string, unknown>>();
let selectCount = 0;
let upsertCount = 0;
/** Set to make the select fail, to prove the wizard fails CLOSED. */
let selectError: { message: string } | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            selectCount += 1;
            if (selectError) return { data: null, error: selectError };
            return { data: stored.get(value) ?? null, error: null };
          },
        }),
      }),
      upsert: async (payload: Record<string, unknown>) => {
        upsertCount += 1;
        stored.set(String(payload.tenant_id), {
          id: 'row-1',
          completed_at: new Date().toISOString(),
          ...payload,
        });
        return { error: null };
      },
    }),
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  stored.clear();
  selectCount = 0;
  upsertCount = 0;
  selectError = null;
  currentTenant = null;
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
});

const SENTINEL = 'DASHBOARD-BEHIND-THE-WIZARD';
const FIRST_PROMPT = FIRST_RUN_QUESTIONS[0].prompt;

/**
 * Let React Query's effect subscribe, its (async) fetch resolve, and the
 * resulting state update paint. A single `act` around `render` is not enough:
 * the query starts in an effect, so its promise settles a macrotask later.
 */
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Mount the wizard for `tenant` and let its query settle. */
async function renderFor(
  tenant: { id: string; slug: string } | null,
  props: { suppressed?: boolean } = {},
): Promise<string> {
  currentTenant = tenant;
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <FirstRunWizard {...props} />
        <div>{SENTINEL}</div>
      </QueryClientProvider>,
    );
  });
  await settle();
  return container.textContent ?? '';
}

function wizardIsUp(): boolean {
  return !!container.querySelector('[data-first-run-wizard]');
}

// ── The three cases ────────────────────────────────────────────────────────

describe('FirstRunWizard — tenant gate, three cases', () => {
  it('CASE 1 — SHOWS for the northwind canary', async () => {
    const text = await renderFor({ id: 'staging-northwind-id', slug: 'northwind' });
    expect(wizardIsUp()).toBe(true);
    expect(text).toContain(FIRST_PROMPT);
    // The tree mounted — so case 2 failing would be a real filter, not a crash.
    expect(text).toContain(SENTINEL);
  });

  it('CASE 2 — does NOT show for real non-canary tenants (the outage case)', async () => {
    for (const slug of [
      'goniko',
      'revtekrentals',
      'globalmotiontransport',
      'jangramrentals',
      'eastpeakrentalsllc',
      'openbayrental',
      'flowrentalsllc',
      'drive-hustle',
      'test',
      'drive-247',
    ]) {
      const text = await renderFor({ id: `id-${slug}`, slug });
      expect(wizardIsUp(), `wizard must stay hidden for ${slug}`).toBe(false);
      expect(text).not.toContain(FIRST_PROMPT);
      expect(text, `the tree must still mount for ${slug}`).toContain(SENTINEL);
    }
    // Not one of them was even asked about — the gate short-circuits before
    // the query, so a non-canary tenant cannot 404 on the unapplied table.
    expect(selectCount).toBe(0);
  });

  it('CASE 3 — does not show, and does not error, on an unresolved or bogus tenant', async () => {
    // `null` is what TenantContext reports while the lookup is in flight and
    // forever on an unrecognised host or a slug that is not a tenant.
    for (const tenant of [
      null,
      { id: 'x', slug: 'not-a-real-tenant' },
      { id: 'x', slug: '' },
      { id: 'x', slug: 'northwind-2' },
      { id: 'x', slug: 'Northwind' },
      { id: 'x', slug: ' northwind' },
    ]) {
      const text = await renderFor(tenant);
      expect(wizardIsUp(), `wizard must stay hidden for ${JSON.stringify(tenant)}`).toBe(
        false,
      );
      expect(text).toContain(SENTINEL);
    }
  });

  it('never keys on a tenant ID', async () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the ungated path in
    // whichever environment it was not written against, with no error and no
    // failed build — so both ids must behave like any other unknown string.
    for (const id of [
      '6e5c544f-b374-451f-a662-360a634bff15',
      '8e6bc88f-86d6-4468-8610-73f7c8a88f6e',
    ]) {
      await renderFor({ id: 'whatever', slug: id });
      expect(wizardIsUp()).toBe(false);
    }
    // …and the canary's real id in the *other* direction: the right slug with
    // either id still shows, because the id is never consulted.
    for (const id of [
      '6e5c544f-b374-451f-a662-360a634bff15',
      '8e6bc88f-86d6-4468-8610-73f7c8a88f6e',
    ]) {
      await renderFor({ id, slug: 'northwind' });
      expect(wizardIsUp()).toBe(true);
    }
  });

  it('stays down while the subscription paywall owns the screen', async () => {
    await renderFor({ id: 'n', slug: 'northwind' }, { suppressed: true });
    expect(wizardIsUp()).toBe(false);
  });

  it('fails CLOSED when the row cannot be read at all', async () => {
    // The migration ships unapplied, so until it is run every select 404s. A
    // full-screen blocker whose storage is missing must stay out of the way
    // rather than trap the operator behind a wizard it can never record.
    selectError = { message: 'relation "public.tenant_first_run" does not exist' };
    const text = await renderFor({ id: 'n', slug: 'northwind' });
    expect(wizardIsUp()).toBe(false);
    expect(text).toContain(SENTINEL);
  });
});

// ── Shown exactly once ─────────────────────────────────────────────────────

/** Find a button by its visible text. */
function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

/** Answer whichever question is on screen, then advance. */
async function answerCurrentStep() {
  const choice = container.querySelector<HTMLElement>('[role="radio"], [role="checkbox"]');
  if (choice) {
    await click(choice);
  } else {
    const input = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      await act(async () => {
        setter.call(input, 'Denver, CO');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }
}

describe('FirstRunWizard — shown exactly once', () => {
  it('completes, persists, and does not come back on the next load', async () => {
    const tenant = { id: 'northwind-id', slug: 'northwind' };

    await renderFor(tenant);
    expect(wizardIsUp()).toBe(true);

    // Walk every step, answering as we go.
    for (let i = 0; i < FIRST_RUN_QUESTIONS.length - 1; i += 1) {
      await answerCurrentStep();
      await click(button('Continue'));
    }
    await answerCurrentStep();
    await click(button('Go to my dashboard'));

    // Written once, and the screen let go of the operator on its own — no
    // reload needed, because the row is the single source of truth.
    expect(upsertCount).toBe(1);
    expect(stored.get(tenant.id)).toBeTruthy();
    expect(stored.get(tenant.id)!.was_skipped).toBe(false);
    expect(Object.keys(stored.get(tenant.id)!.answers as object).length).toBeGreaterThan(
      0,
    );
    expect(wizardIsUp()).toBe(false);

    // A completely fresh load — new QueryClient, new root, same tenant.
    queryClient.clear();
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const text = await renderFor(tenant);
    expect(wizardIsUp(), 'the wizard must not return after completion').toBe(false);
    expect(text).toContain(SENTINEL);
  });

  it('"Skip for now" also counts as seen, and stores no answers', async () => {
    const tenant = { id: 'northwind-id-2', slug: 'northwind' };

    await renderFor(tenant);
    expect(wizardIsUp()).toBe(true);

    await click(button('Skip for now'));

    expect(upsertCount).toBe(1);
    const row = stored.get(tenant.id)!;
    expect(row.was_skipped).toBe(true);
    expect(row.answers).toEqual({});
    expect(wizardIsUp()).toBe(false);

    // And it stays gone.
    const text = await renderFor(tenant);
    expect(wizardIsUp()).toBe(false);
    expect(text).toContain(SENTINEL);
  });

  it('will not advance past a required question that has no answer', async () => {
    await renderFor({ id: 'northwind-id-3', slug: 'northwind' });
    // FIRST_RUN_QUESTIONS[0] is required, and nothing is selected yet.
    expect(button('Continue').disabled).toBe(true);
    await answerCurrentStep();
    expect(button('Continue').disabled).toBe(false);
  });
});
