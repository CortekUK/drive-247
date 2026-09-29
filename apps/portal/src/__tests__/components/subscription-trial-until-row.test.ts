/**
 * "Free Trial Until" on the billing page — the date a deferred tenant needs.
 *
 * WHY IT IS NOT DRIVEN BY `isTrialing`
 * -----------------------------------
 * `useTenantSubscription` deliberately reports `isTrialing: false` for a tenant
 * that has already gone live (`tenants.setup_completed_at`). The UK->UAE
 * migration parks migrated operators at status 'trialing' with a future
 * `trial_end` so the first UAE charge lands where the UK period ended, and
 * treating that as a real trial re-triggered the Setup Mode UI on established
 * businesses. That guard has to stay.
 *
 * But the DATE is a plain billing fact those same tenants still need. When
 * support defers someone's billing by extending the trial — NealCo Rentals,
 * moved to 1 Jan 2027 after a billing query on 29 Sep 2026 — the only thing on
 * screen was a Next Payment date that had silently moved, with nothing saying
 * why. So the row reads the subscription ROW (status + trial_end), never the
 * derived flag.
 *
 * What is pinned here is exactly that separation, because the obvious
 * "simplification" is to reach for `isTrialing` and it would make the row
 * invisible to every tenant it was built for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../../app/(dashboard)/subscription/page.tsx'),
  'utf8',
);

/** Strip both comment forms: a comment explaining the rule is not the rule. */
const code = src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the Free Trial Until row', () => {
  it('appears in both billing cards (v1 chrome and v2)', () => {
    const hits = code.match(/Free Trial Until/g) ?? [];
    expect(hits).toHaveLength(2);
  });

  it('is driven by the subscription row, not by the derived isTrialing flag', () => {
    expect(code).toMatch(/shownSubscription\?\.status === "trialing"/);
    expect(code).toMatch(/shownSubscription\?\.trial_end/);
  });

  it('never gates itself on isTrialing, which is false for a live tenant', () => {
    // If this ever fails, the row has been "simplified" into invisibility for
    // every migrated or support-deferred tenant — the only ones who need it.
    const rowRegion = code.slice(
      Math.max(0, code.indexOf('Free Trial Until') - 600),
      code.indexOf('Free Trial Until') + 400,
    );
    expect(rowRegion).not.toMatch(/\bisTrialing\b/);
    expect(rowRegion).not.toMatch(/trialDaysRemaining/);
  });

  it('hides itself once the trial end has passed', () => {
    expect(code).toMatch(
      /new Date\(shownSubscription\.trial_end\)\.getTime\(\) > Date\.now\(\)/,
    );
  });

  it('leaves Next Payment reading current_period_end, which Stripe moves for us', () => {
    // Stripe sets current_period_end to the trial end while trialing, and the
    // subscription webhook writes it. So deferring billing in Stripe updates
    // this date with no code change — the row above only explains it.
    expect(code).toMatch(/Next Payment/);
    expect(code).toMatch(/shownSubscription\?\.current_period_end/);
  });
});
