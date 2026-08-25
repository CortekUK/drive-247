#!/usr/bin/env node
/**
 * Square guardrail — banned provider predicates and banned resolver aliases.
 *
 * `.eq('payment_provider','stripe')` is the ONLY sanctioned predicate, because
 * the column is NOT NULL DEFAULT 'stripe'. `.neq(...)` and `.is(..., null)` would
 * have been correct under a nullable column and are silently wrong under this
 * one — the class of bug that turns recover-pending-stripe-payments (pg_cron
 * jobid 34, every minute) into a no-op.
 *
 * Also bans raw provider-name comparisons outside the seam, so behavioural
 * differences stay in capabilities.ts.
 */
import { execSync } from 'node:child_process';

const RULES = [
  {
    name: 'banned predicate .neq(payment_provider)',
    pattern: "\\.neq\\(\\s*['\\\"]payment_provider",
    allow: ['supabase/functions/_shared/payments/'],
  },
  {
    name: 'banned predicate .is(payment_provider, null)',
    pattern: "\\.is\\(\\s*['\\\"]payment_provider",
    allow: ['supabase/functions/_shared/payments/'],
  },
  {
    name: "raw provider comparison outside the seam",
    pattern: "===\\s*['\\\"]square['\\\"]",
    allow: ['supabase/functions/_shared/payments/', 'apps/portal/src/lib/payment-', 'apps/booking/src/lib/payment-', 'apps/admin/lib/payment-'],
  },
  {
    name: 'banned resolver alias',
    pattern: "function (getTenantProvider|providerFor|resolveProvider|getPaymentProvider|whichProvider)\\b",
    allow: [],
  },
];

let failed = false;
for (const rule of RULES) {
  let hits = '';
  try {
    hits = execSync(
      `grep -rnE "${rule.pattern}" supabase/functions apps --include=*.ts --include=*.tsx || true`,
      { encoding: 'utf8' },
    );
  } catch { /* grep exit 1 = no match */ }

  const lines = hits.split('\n').filter(Boolean)
    .filter((l) => !l.includes('node_modules'))
    .filter((l) => !rule.allow.some((a) => l.startsWith(a)))
    // A rule about code must never fire on prose describing the rule.
    .filter((l) => {
      const body = l.replace(/^[^:]+:\d+:/, '').trim();
      return !(body.startsWith('*') || body.startsWith('//') || body.startsWith('/*'));
    });

  if (lines.length) {
    console.error(`\n[predicates] ${rule.name} — ${lines.length} violation(s):`);
    for (const l of lines) console.error('  ' + l);
    failed = true;
  } else {
    console.log(`[predicates] ok  ${rule.name}`);
  }
}
process.exit(failed ? 1 : 0);
