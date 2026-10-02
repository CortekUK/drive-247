// =============================================================================
// The combined SETUP screen — company, web address and card, one submit.
//
// THE ORDER IS THE WHOLE DESIGN.
//   1. slug check    — free to fail, nothing irreversible has happened
//   2. confirmPayment — the ONLY irreversible step
//   3. provision     — builds the tenant
//
// Checking the slug AFTER the card means a paid customer with no tenant and a
// name they cannot have — and `signup-provision` deliberately never refunds to
// tidy up. Holding this order is what removes the need for a slug reservation
// table: the seconds between 1 and 3 are covered by `tenants_slug_key` and by
// `signup-provision` re-running every check.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const step = strip(read('apps/web/src/components/onboarding/steps/setup-step.tsx'));
const resume = strip(read('supabase/functions/signup-resume/index.ts'));

describe('the submit sequence', () => {
  it('checks the slug BEFORE confirming the card', () => {
    const slug = step.indexOf('onVerifySlug');
    const card = step.indexOf('confirmPayment');
    expect(slug).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(-1);
    expect(slug).toBeLessThan(card);
  });

  it('provisions only AFTER the card has confirmed', () => {
    const card = step.indexOf('confirmPayment');
    const provision = step.indexOf('await onProvision()');
    expect(provision).toBeGreaterThan(card);
  });

  it('stops dead when the slug is taken, without touching the card', () => {
    expect(step).toMatch(/if \(!slugOk\) return;/);
  });
});

describe('the Payment Element can actually mount', () => {
  it('mints the intent on arrival, not on submit', () => {
    // It cannot mount without a client secret, so deferring would show an empty
    // box until the operator pressed a button that needs the box filled in.
    expect(step).toMatch(/if \(!hasClientSecret\) onNeedIntent\(\)/);
  });

  it('does not re-implement loadStripe', () => {
    // payment-step.tsx has hardened that: a blocked script resolves to null, a
    // stalled one never settles, and both render a silently empty box.
    expect(step).not.toMatch(/loadStripe/);
    expect(step).toMatch(/useStripe\(\)/);
    expect(step).toMatch(/useElements\(\)/);
  });
});

describe('the submit cannot fire half-ready', () => {
  it('requires stripe, the secret, the fields and the terms', () => {
    for (const guard of [
      /!!stripe/, /!!elements/, /hasClientSecret/,
      /tenant\.companyName\.trim\(\)\.length > 0/,
      /tenant\.slug\.trim\(\)\.length > 0/,
      /tenant\.acceptedTerms === true/,
    ]) {
      expect(step).toMatch(guard);
    }
  });

  it('refuses while the slug is still being checked, or is unavailable', () => {
    // `taken` is a REASON under the `unavailable` kind, not a kind of its own —
    // asserting the kind is what actually blocks reserved and invalid too.
    expect(step).toMatch(/slugState\.kind !== "checking"/);
    expect(step).toMatch(/slugState\.kind !== "unavailable"/);
  });
});

describe('resume knows about the combined step, behind a flag', () => {
  it('is off unless the flag is exactly "true"', () => {
    expect(resume).toMatch(/SIGNUP_SETUP_STEP_ENABLED"\) === "true"/);
  });

  it('sends anything still missing to the one screen that collects it', () => {
    expect(resume).toMatch(/!businessDone \|\| !paid/);
    expect(resume).toMatch(/\?\s*"setup"/);
  });

  it('leaves the live business/payment pair untouched when off', () => {
    expect(resume).toMatch(/} else if \(!paid\) \{\s*resumeStep = "payment";/);
  });
});
