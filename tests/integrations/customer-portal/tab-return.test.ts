// =============================================================================
// Coming back to the portal tab must not rebuild the page.
//
// Reported 30 Sep 2026: "it takes a lot more time to load, and when I come back
// to the portal tab it refreshes again — if I go to another tab and then again
// go to customer portal it refreshes again."
//
// TWO CAUSES, one per portal, and they are different.
//
// NORTHWIND. `customer-auth-store` short-circuited only `TOKEN_REFRESHED`.
// Supabase ALSO re-emits `SIGNED_IN` when a tab regains focus and revalidates
// the session, and that fell through to `membershipResolved: false`.
// `CustomerAuthContext` derives `isLoading` from that flag, and
// `(portal)/layout.tsx` refuses to mount children while loading — on purpose,
// so no page queries against a stale customer id. So every tab return tore the
// tree down, flashed the skeleton and replayed every query on the page.
//
// LEGACY (63 of 64 active tenants). No guard at all: every auth event ran
// `fetchCustomerUser` AND `isGloballyBlacklisted`, two round-trips per tab
// focus. On top of that its QueryClient was `new QueryClient()` with no
// options — `staleTime: 0` and `refetchOnWindowFocus: true` — so every query on
// the page refetched too.
//
// THE FIX IS NOT "TURN REFETCHING OFF". Agreements open the signing page in a
// NEW TAB, so returning to the portal is the only moment we learn a document
// was signed. The legacy client keeps focus refetching and gains a stale
// window instead; the auth guards are keyed on the USER ID, so a genuinely
// different user still re-resolves.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NW_STORE = 'apps/booking/src/northwind-site/lib/stores/customer-auth-store.ts';
const LEGACY_STORE = 'apps/booking/src/stores/customer-auth-store.ts';
const LEGACY_QC = 'apps/booking/src/components/QueryClientProvider.tsx';

describe('the same person returning is not treated as a new sign-in', () => {
  for (const [name, rel] of [
    ['northwind', NW_STORE],
    ['legacy', LEGACY_STORE],
  ] as const) {
    it(`${name}: short-circuits on the user id, not on the event name`, () => {
      const src = strip(read(rel));
      // Keyed on identity, so it holds for SIGNED_IN, TOKEN_REFRESHED, and
      // whatever else Supabase decides to re-emit on focus.
      expect(src, name).toMatch(/session\.user\.id === previousUserId/);
      expect(src, name).toMatch(/const previousUserId = get\(\)\.user\?\.id \?\? null/);
    });

    it(`${name}: captures the previous id BEFORE overwriting it`, () => {
      const src = strip(read(rel));
      const captured = src.indexOf('const previousUserId');
      const overwritten = src.indexOf('set({ session, user: session?.user ?? null');
      expect(captured, name).toBeGreaterThan(-1);
      expect(overwritten, name).toBeGreaterThan(-1);
      // If the set runs first, previousUserId is the NEW id, the guard always
      // matches, and a real account switch would silently keep the old
      // membership — the one failure mode worse than the bug being fixed.
      expect(captured, name).toBeLessThan(overwritten);
    });

    it(`${name}: still resolves when we have no membership yet`, () => {
      // A first sign-in must fall through and run the block/blacklist checks.
      const src = strip(read(rel));
      expect(src, name).toMatch(/get\(\)\.(membership|customerUser) &&/);
    });
  }
});

describe('the legacy query client stops replaying every query on focus', () => {
  const src = strip(read(LEGACY_QC));

  it('has a stale window instead of React Query defaults', () => {
    expect(src).toMatch(/staleTime:\s*30_000/);
    expect(src).not.toMatch(/new QueryClient\(\)/);
  });

  it('KEEPS focus refetching, because signing happens in another tab', () => {
    // agreements/page.tsx and bookings/[id]/page.tsx both call
    // `window.open(signingUrl, '_blank')`. Returning to the portal tab is the
    // only signal that the document was signed.
    expect(src).toMatch(/refetchOnWindowFocus:\s*true/);
  });
});
