/**
 * The payment-plans gate: the canary slug AND reachable tables. Before the
 * migration is applied PostgREST answers 42P01 / PGRST205, and the feature
 * must simply be absent — never an error on screen.
 */
import { describe, expect, it } from 'vitest';
import { isMissingRelation, isPaymentPlansTenant, probePaymentPlans, type ProbeClient } from '@/lib/payment-plans-ui/feature';

const client = (reply: { error: unknown } | Error): ProbeClient => ({
  from: () => ({
    select: () => ({
      limit: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)),
    }),
  }),
});

describe('payment plans gate', () => {
  it('is the canary slug and nothing else', () => {
    expect(isPaymentPlansTenant('northwind')).toBe(true);
    for (const s of ['northwind2', 'nasir', 'squad', '', null, undefined]) expect(isPaymentPlansTenant(s)).toBe(false);
  });

  it('recognises every "table does not exist yet" shape', () => {
    expect(isMissingRelation({ code: '42P01', message: 'relation "public.payment_plans" does not exist' })).toBe(true);
    expect(isMissingRelation({ code: 'PGRST205', message: "Could not find the table 'public.payment_plans' in the schema cache" })).toBe(true);
    expect(isMissingRelation({ message: "Could not find the table 'public.payment_plans' in the schema cache" })).toBe(true);
    expect(isMissingRelation({ code: '42501', message: 'permission denied for table payment_plans' })).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
  });

  it('probes to available / missing / error', async () => {
    expect(await probePaymentPlans(client({ error: null }))).toBe('available');
    expect(await probePaymentPlans(client({ error: { code: '42P01', message: 'x' } }))).toBe('missing');
    expect(await probePaymentPlans(client({ error: { code: 'PGRST205', message: 'x' } }))).toBe('missing');
    expect(await probePaymentPlans(client({ error: { code: '500', message: 'boom' } }))).toBe('error');
    expect(await probePaymentPlans(client(new Error('network')))).toBe('error');
  });
});
