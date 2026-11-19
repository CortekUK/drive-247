/**
 * Apple Pay / Google Pay showed "Starter plan AED 129.00 per month" on the
 * free-trial payment step.
 *
 * A SetupIntent has no currency, so a Payment Element built from its client
 * secret let the wallet sheets fall back to the Stripe account's default
 * currency, and signups bill through the UAE account (AED). The trial form is
 * now built in deferred mode with currency "usd" and confirms the same
 * SetupIntent by its client secret after elements.submit().
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../../../apps/web/src/components/onboarding/steps/payment-step.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('the free-trial card form states its currency', () => {
  it('builds the trial (setup) form in deferred mode with currency usd', () => {
    expect(src).toContain('clientSecret && (isMockSignup() || intentType === "setup")');
    const deferred = src.slice(src.indexOf('clientSecret && (isMockSignup() || intentType === "setup")'));
    expect(deferred.slice(0, 400)).toMatch(/mode: "setup",\s*currency: "usd",\s*paymentMethodTypes: \["card"\]/);
  });

  it('checks the fields, then confirms the SetupIntent by its client secret', () => {
    const setup = src.slice(src.indexOf('if (intentType === "setup") {'));
    const submitAt = setup.indexOf('await elements.submit()');
    const confirmAt = setup.indexOf('stripe.confirmSetup({');
    expect(submitAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(submitAt);
    expect(setup.slice(confirmAt, confirmAt + 200)).toContain('clientSecret');
  });
});
