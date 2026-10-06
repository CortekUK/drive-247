import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  compressOffsets,
  cycleKey,
  formatSeconds,
  nextBillingDate,
  renewalReminderDueAt,
  selectSubscription,
  signupStepDueAt,
  testOffsetSeconds,
  renewalTestSeconds,
  latestDueIndex,
  latestRepeatDue,
  repeatEveryMs,
  daysText,
  type SubscriptionFacts,
} from '@/lib/customer-management/schedule';
import { AUTOMATIONS, DEFAULT_STEPS, SETTINGS_DEFAULTS } from '@/lib/customer-management/catalog';

/*
 * The Customer Management Service decides, unattended and on a minutely cron,
 * whether to email a paying operator. Every test here is a specific wrong
 * email it would otherwise send.
 */

const DAY = 86_400_000;
const sub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  status: 'active',
  current_period_end: '2026-11-01T00:00:00Z',
  trial_end: null,
  cancel_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

/* -------------------------------------------------------------------------- */

describe('time compression holds the two anchors it was specified at', () => {
  it('7 days behaves like 1 minute and 14 days like 3', () => {
    expect(testOffsetSeconds(7)).toBe(60);
    expect(testOffsetSeconds(14)).toBe(180);
  });

  it('day 0 is immediate', () => {
    expect(testOffsetSeconds(0)).toBe(0);
    expect(formatSeconds(0)).toBe('immediately');
  });

  it('keeps going past the last anchor instead of flattening onto it', () => {
    // A step added at day 30 must still be later than the day-14 one, or the
    // two collide and the rehearsal shows a sequence nobody will receive.
    expect(testOffsetSeconds(30)).toBeGreaterThan(testOffsetSeconds(14));
  });

  it('keeps a whole timeline distinct and in order', () => {
    /*
     * THE BUG THIS EXISTS FOR. At minute resolution day 0 and day 3 both
     * compress to 0, so the welcome and the day-3 mail arrive together and the
     * one thing a rehearsal is for — the ORDER — is invisible. Seconds keep
     * them apart without moving day 7 off its anchor.
     */
    const map = compressOffsets([0, 3, 7, 14]);
    const values = [0, 3, 7, 14].map((d) => map.get(d)!);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
    expect(map.get(7)).toBe(60);
    expect(map.get(14)).toBe(180);
  });

  it('separates offsets that would otherwise round together', () => {
    const map = compressOffsets([1, 2]);
    expect(map.get(2)!).toBeGreaterThan(map.get(1)!);
  });
});

/* -------------------------------------------------------------------------- */

describe('signup steps', () => {
  it('count forward from the signup date in production', () => {
    const due = signupStepDueAt({
      signedUpAt: '2026-10-01T09:00:00Z',
      offsetDays: 7,
      testMode: false,
    });
    expect(due?.toISOString()).toBe('2026-10-08T09:00:00.000Z');
  });

  it('count from the rehearsal start in test mode, NOT from the signup date', () => {
    /*
     * An operator who signed up last year is already past every offset, so
     * anchoring a rehearsal on their signup date would mark the whole sequence
     * due at once — three emails in one tick and nothing learned.
     */
    const due = signupStepDueAt({
      signedUpAt: '2025-01-01T00:00:00Z',
      offsetDays: 14,
      testMode: true,
      anchorAt: '2026-10-06T12:00:00Z',
    });
    expect(due?.toISOString()).toBe('2026-10-06T12:03:00.000Z');
  });

  it('refuse to schedule in test mode with no anchor', () => {
    expect(
      signupStepDueAt({ signedUpAt: '2026-10-01T00:00:00Z', offsetDays: 7, testMode: true, anchorAt: null }),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('renewal reminders go out before the charge', () => {
  it('count backward from the billing date', () => {
    const due = renewalReminderDueAt({
      billingDate: '2026-11-01T00:00:00Z',
      offsetDays: 7,
      testMode: false,
    });
    expect(due?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('do not pretend to move a real Stripe date in test mode', () => {
    // The rehearsal anchors on its own start; the date in the email stays real.
    const due = renewalReminderDueAt({
      billingDate: '2027-06-01T00:00:00Z',
      offsetDays: 7,
      testMode: true,
      anchorAt: '2026-10-06T12:00:00Z',
    });
    expect(due?.toISOString()).toBe('2026-10-06T12:01:00.000Z');
  });
});

/* -------------------------------------------------------------------------- */

describe('who must NOT receive a renewal reminder', () => {
  const now = new Date('2026-10-06T00:00:00Z');

  it('somebody who has already cancelled', () => {
    /*
     * THE WORST EMAIL IN THE SET. `cancel_at` is set when an operator cancels
     * but keeps the period they paid for; the row stays 'active' with a future
     * `current_period_end`, so the naive query finds a healthy subscriber and
     * tells somebody who has already left that we are about to charge them
     * again. (rentals/page.tsx:276-283 had to learn the same thing.)
     */
    const result = nextBillingDate(sub({ cancel_at: '2026-10-20T00:00:00Z' }), now);
    expect(result.skip).toBe('scheduled_to_cancel');
    expect(result.date).toBeNull();
  });

  it('somebody who already owes us money', () => {
    // A failed charge still advances current_period_end by a full period, so
    // this would promise a renewal next month to somebody past due now.
    expect(nextBillingDate(sub({ status: 'past_due' }), now).skip).toBe('past_due');
  });

  it('a cancellation already in the past does not block the reminder', () => {
    // cancel_at in the past means the cancellation has been superseded; the
    // guard is for a cancellation still pending.
    expect(nextBillingDate(sub({ cancel_at: '2026-09-01T00:00:00Z' }), now).skip).toBeNull();
  });

  it('a lapsed subscription', () => {
    expect(nextBillingDate(sub({ status: 'canceled' }), now).skip).toBe('not_live');
  });

  it('a tenant with no subscription at all', () => {
    expect(nextBillingDate(null, now).skip).toBe('no_subscription');
  });

  it('a period end that has already gone by', () => {
    expect(nextBillingDate(sub({ current_period_end: '2026-09-01T00:00:00Z' }), now).skip).toBe(
      'billing_date_passed',
    );
  });
});

describe('a trial bills at the end of the trial', () => {
  it('uses trial_end, not current_period_end', () => {
    const result = nextBillingDate(
      sub({ status: 'trialing', trial_end: '2026-10-20T00:00:00Z' }),
      new Date('2026-10-06T00:00:00Z'),
    );
    expect(result.date?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

/* -------------------------------------------------------------------------- */

describe('which subscription the reminder is dated from', () => {
  it('ignores a retired row left behind by the platform migration', () => {
    /*
     * A tenant migrated between the two Stripe platforms KEEPS its retired UK
     * row. Taking the first would date the reminder from a subscription that
     * stopped billing a year ago.
     */
    const retired = sub({ status: 'canceled', created_at: '2025-01-01T00:00:00Z' });
    const live = sub({ status: 'active', created_at: '2026-01-01T00:00:00Z' });
    expect(selectSubscription([retired, live])).toBe(live);
    expect(selectSubscription([live, retired])).toBe(live);
  });

  it('falls back to the most recent when none is live', () => {
    const older = sub({ status: 'canceled', created_at: '2024-01-01T00:00:00Z' });
    const newer = sub({ status: 'canceled', created_at: '2025-06-01T00:00:00Z' });
    expect(selectSubscription([older, newer])).toBe(newer);
  });

  it('is null for a tenant with none', () => {
    expect(selectSubscription([])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('a send happens once', () => {
  it('a signup step is one-shot', () => {
    expect(cycleKey({ automation: 'signup' })).toBe('once');
  });

  it('a renewal reminder recurs once per billing period', () => {
    // Keyed on the billing DAY, so a monthly tenant is reminded twelve times a
    // year rather than once ever.
    const october = cycleKey({ automation: 'renewal', anchor: '2026-11-01T00:00:00Z' });
    const november = cycleKey({ automation: 'renewal', anchor: '2026-12-01T00:00:00Z' });
    expect(october).toBe('2026-11-01');
    expect(november).not.toBe(october);
  });

  it('a receipt is keyed on the payment, so a replayed webhook is harmless', () => {
    expect(cycleKey({ automation: 'receipt', anchor: 'in_1P9xKl' })).toBe('in_1P9xKl');
  });

  it('a rehearsal never consumes the production slot', () => {
    /*
     * Without the prefix, testing the day-7 email for Northwind would file a
     * 'sent' row that permanently suppresses the real one — a test that breaks
     * the thing it tested.
     */
    const real = cycleKey({ automation: 'signup' });
    const rehearsal = cycleKey({ automation: 'signup', testMode: true, testRunId: 'abc123' });
    expect(rehearsal).not.toBe(real);
    expect(rehearsal.startsWith('test:')).toBe(true);
  });

  it('two rehearsals do not block each other', () => {
    const first = cycleKey({ automation: 'signup', testMode: true, testRunId: 'run1' });
    const second = cycleKey({ automation: 'signup', testMode: true, testRunId: 'run2' });
    expect(first).not.toBe(second);
  });
});

/* -------------------------------------------------------------------------- */

describe('the shipped defaults', () => {
  it("send billing receipts, quoting Stripe's own references", () => {
    // Turned on deliberately (Oct 2026): every paid subscription invoice gets
    // a receipt carrying Stripe's invoice number, invoice id and payment id.
    expect(SETTINGS_DEFAULTS.receipt_enabled).toBe(true);
    const receipt = DEFAULT_STEPS.filter((s) => s.automation === 'receipt');
    expect(receipt).toHaveLength(1);
    expect(receipt[0].enabled).toBe(true);
    for (const key of ['receipt_amount', 'stripe_invoice_number', 'stripe_invoice_id', 'stripe_payment_id', 'receipt_url']) {
      expect(receipt[0].body_html).toContain(`{{${key}}}`);
    }
  });

  it('say on the tab that Stripe sends its own receipt too', () => {
    const meta = AUTOMATIONS.find((a) => a.id === 'receipt')!;
    expect(meta.caution).toMatch(/Stripe also emails its own receipt/i);
  });

  it('reach only the rehearsal tenant until somebody widens it', () => {
    expect(SETTINGS_DEFAULTS.scope_all_tenants).toBe(false);
    expect(SETTINGS_DEFAULTS.scope_tenant_slug).toBe('northwind');
  });

  it('cap one run, so widening the scope cannot mail the platform at once', () => {
    expect(SETTINGS_DEFAULTS.max_sends_per_run).toBeGreaterThan(0);
    expect(SETTINGS_DEFAULTS.max_sends_per_run).toBeLessThanOrEqual(500);
  });

  it('ship the signup sequence as a welcome, two reminders that repeat until done, and two confirmations', () => {
    const signup = DEFAULT_STEPS.filter((s) => s.automation === 'signup');
    expect(signup.map((s) => s.step_key)).toEqual([
      'signup_day_0_welcome',
      'signup_day_7_connect_stripe',
      'signup_day_7_bonzah_form',
      'signup_stripe_connected',
      'signup_bonzah_active',
    ]);
    // A repeat with no condition would never stop.
    for (const s of signup) {
      if (s.repeat_every_days) expect(s.send_if, s.step_key).toBeTruthy();
    }
    // A confirmation is sent once, when it happens — never repeated.
    for (const s of signup.filter((x) => x.send_if === 'stripe_connected' || x.send_if === 'bonzah_active')) {
      expect(s.repeat_every_days ?? null, s.step_key).toBeNull();
    }
  });

  it('use only variable names the runner can fill', () => {
    // A name the runner does not know is left in the email verbatim, which is
    // visible but ugly. Catch it here instead.
    const known = new Set([
      'tenant_name',
      'tenant_slug',
      'tenant_admin_name',
      'tenant_contact_email',
      'sign_in_email',
      'portal_url',
      'booking_url',
      'stripe_connect_url',
      'bonzah_form_url',
      'plan_name',
      'plan_amount',
      'plan_interval',
      'renewal_date',
      'days_until_renewal',
      'days_until_renewal_text',
      'receipt_amount',
      'receipt_date',
      'receipt_reference',
      'stripe_invoice_number',
      'stripe_invoice_id',
      'stripe_payment_id',
      'receipt_url',
      'invoice_pdf_url',
    ]);
    for (const step of DEFAULT_STEPS) {
      const used = [...`${step.subject} ${step.body_html}`.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)];
      for (const [, key] of used) {
        expect(known, `${step.step_key} uses {{${key}}}`).toContain(key.toLowerCase());
      }
    }
  });

  it('give every step a key the database CHECK will accept', () => {
    for (const step of DEFAULT_STEPS) {
      expect(step.step_key).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('the Deno twin has not drifted', () => {
  /*
   * The admin page tells somebody when an email will go out; the runner decides
   * when it actually does. The two answering differently is the one bug nobody
   * would notice until an operator complained, and the only reason there are
   * two copies is that this monorepo has no shared package (CLAUDE.md).
   */
  const ROOT = resolve(__dirname, '../../../..');
  const stripHeader = (src: string) => src.slice(src.indexOf('*/') + 2).replace(/^\r?\n/, '');

  it('is byte-identical below the file header', () => {
    const admin = readFileSync(resolve(ROOT, 'apps/admin/lib/customer-management/schedule.ts'), 'utf8');
    const deno = readFileSync(
      resolve(ROOT, 'supabase/functions/customer-management-run/schedule.ts'),
      'utf8',
    );
    expect(stripHeader(deno)).toBe(stripHeader(admin));
  });

  it('stays importable by Deno: no bare-specifier imports', () => {
    const deno = readFileSync(
      resolve(ROOT, 'supabase/functions/customer-management-run/schedule.ts'),
      'utf8',
    );
    // Deno has no import map here, so anything that is not a URL or a relative
    // path would fail at deploy time rather than in any check run locally.
    expect(deno).not.toMatch(/^\s*import\s[^'"]*['"][^./h]/m);
  });
});

/* -------------------------------------------------------------------------- */

describe('the renewal countdown: 3, 2, 1 days before payment', () => {
  it('ships exactly the 3-day, 2-day and 1-day reminders', () => {
    const offsets = DEFAULT_STEPS.filter((s) => s.automation === 'renewal').map((s) => s.offset_days);
    expect(offsets.sort()).toEqual([1, 2, 3]);
  });

  it('sends each one that many days before the payment date', () => {
    const payment = '2026-10-30T09:00:00Z';
    const at = (d: number) =>
      renewalReminderDueAt({ billingDate: payment, offsetDays: d, testMode: false })!.toISOString();
    expect(at(3)).toBe('2026-10-27T09:00:00.000Z');
    expect(at(2)).toBe('2026-10-28T09:00:00.000Z');
    expect(at(1)).toBe('2026-10-29T09:00:00.000Z');
  });

  it('only sends the most recent due reminder, never the whole countdown at once', () => {
    // A tenant first seen with one day left: the 3-day and 2-day reminders are
    // also "due", but only "1 day left" is true now.
    const due = [3, 2, 1].map((d) => Date.parse('2026-10-30T09:00:00Z') - d * DAY);
    expect(latestDueIndex(due)).toBe(2);
    expect(latestDueIndex([])).toBe(-1);
  });

  it('counts down in test mode, one minute per day, 3 days left first', () => {
    const map = renewalTestSeconds([3, 2, 1]);
    expect(map.get(3)).toBe(0);
    expect(map.get(2)).toBe(60);
    expect(map.get(1)).toBe(120);
  });

  it('says "1 day", not "1 days"', () => {
    expect(daysText(3)).toBe('3 days');
    expect(daysText(1)).toBe('1 day');
  });
});

describe('repeating setup reminders', () => {
  const signup = new Date('2026-10-01T00:00:00Z');
  const first = new Date(signup.getTime() + 3 * DAY);
  const every = repeatEveryMs(3, false);
  const at = (days: number) => new Date(signup.getTime() + days * DAY);

  it('goes out on day 3, 6 and 9 — the example it was asked for', () => {
    expect(latestRepeatDue({ firstDueAt: first, everyMs: every, now: at(2) })).toBeNull();
    expect(latestRepeatDue({ firstDueAt: first, everyMs: every, now: at(3) })?.occurrence).toBe(0);
    expect(latestRepeatDue({ firstDueAt: first, everyMs: every, now: at(5.9) })?.occurrence).toBe(0);
    expect(latestRepeatDue({ firstDueAt: first, everyMs: every, now: at(6) })).toEqual({ occurrence: 1, dueAt: at(6) });
    expect(latestRepeatDue({ firstDueAt: first, everyMs: every, now: at(9) })).toEqual({ occurrence: 2, dueAt: at(9) });
  });

  it('never hands back a backlog: day 10 is the day-9 reminder only', () => {
    expect(latestRepeatDue({ firstDueAt: first, everyMs: every, now: at(10) })).toEqual({ occurrence: 2, dueAt: at(9) });
  });

  it('gives each repeat its own send-log key, apart from one-shot steps and from rehearsals', () => {
    expect(cycleKey({ automation: 'signup' })).toBe('once');
    expect(cycleKey({ automation: 'signup', occurrence: 0 })).toBe('rep:0');
    expect(cycleKey({ automation: 'signup', occurrence: 2 })).toBe('rep:2');
    expect(cycleKey({ automation: 'signup', occurrence: 2, testMode: true, testRunId: 'r1' })).toBe('test:r1:rep:2');
  });

  it('compresses the interval in test mode, and treats no interval as no repeat', () => {
    expect(repeatEveryMs(3, true)).toBe(testOffsetSeconds(3) * 1000);
    expect(repeatEveryMs(0, false)).toBe(0);
    expect(latestRepeatDue({ firstDueAt: first, everyMs: 0, now: at(30) })).toBeNull();
  });
});
