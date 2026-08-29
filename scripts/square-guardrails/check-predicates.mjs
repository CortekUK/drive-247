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
 *
 * WIDENING NOTE (why there are so many spellings below):
 * a rule that matches one spelling is a rule you can step around without
 * noticing. `provider === 'square'` was caught; `provider == 'square'`,
 * `provider !== 'stripe'`, `` provider === `square` ``, `'square' === provider`,
 * `list.includes('square')`, `case 'square':`, `const S = 'square'` and
 * `.eq('payment_provider', someVar)` all sailed through. Each is now its own
 * rule with its own id, so a failure names the exact shape that was used and
 * check-meta.mjs can prove that shape still fails.
 *
 * FALSE POSITIVES ARE THE REAL COST, so the widening is deliberately asymmetric:
 *   - every comparison shape against the literal 'square' is banned;
 *   - only the NEGATED shapes against 'stripe' are banned. `x === 'stripe'` is
 *     left alone because three long-standing UI sites legitimately spell it
 *     (`pendingConfirm?.type === 'stripe'`, `pendingModeChange?.type === 'stripe'`,
 *     `task === "stripe"`) and none of them is a money path. A bare `provider`
 *     identifier is likewise NOT keyed on: this repo overloads the word for
 *     accounting (`provider === "xero"`), insurance (`doc.provider === "bonzah"`)
 *     and verification (`provider === 'ai'`) — 45 innocent sites.
 *
 * Usage:
 *   node scripts/square-guardrails/check-predicates.mjs
 *   node scripts/square-guardrails/check-predicates.mjs --only square-literal-compare
 *
 * --only runs a single rule and still keys off the process exit status, which
 * is how check-meta.mjs attributes a mutation to the rule that is supposed to
 * catch it. Never decide pass/fail by grepping this script's output.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Roots this gate polices. `scripts/` is deliberately NOT scanned: this file
 *  and check-meta.mjs both carry violating snippets on purpose. */
const ROOTS = ['supabase/functions', 'apps'];

/** The seam is where provider-specific behaviour is allowed to exist at all. */
const SEAM = 'supabase/functions/_shared/payments/';

/** Pre-existing app-side payment helpers, carved out before this widening. */
const PAYMENT_LIBS = [
  'apps/portal/src/lib/payment-',
  'apps/booking/src/lib/payment-',
  'apps/admin/lib/payment-',
];

/** Comparison operators, longest first so a failure quotes the real operator. */
const CMP = '(===|!==|==|!=)';
/** A quote of any kind, including a backtick (template-literal spelling). */
const Q = "['\"`]";

/**
 * Every rule is { id, name, pattern, allow, why, refine? }.
 *  - pattern  POSIX ERE handed straight to grep -E (NOT through a shell, so
 *             backticks and quotes need no escaping).
 *  - allow    path PREFIXES exempt from this rule only.
 *  - refine   optional second pass in JS for rules grep alone cannot express;
 *             returns true when the line really is a violation.
 */
export const RULES = [
  {
    id: 'neq-provider',
    name: 'banned predicate .neq(payment_provider)',
    pattern: `\\.neq\\(\\s*['"]payment_provider`,
    allow: [SEAM],
    why: "the column is NOT NULL DEFAULT 'stripe', so .neq matches zero rows",
  },
  {
    id: 'is-provider-null',
    name: 'banned predicate .is(payment_provider, null)',
    pattern: `\\.is\\(\\s*['"]payment_provider`,
    allow: [SEAM],
    why: 'no row has a NULL provider; .is(...) silently selects nothing',
  },
  {
    id: 'square-literal-compare',
    name: "raw 'square' comparison outside the seam (any operator, any quote, either side)",
    pattern: `(${CMP}\\s*${Q}square${Q}|${Q}square${Q}\\s*${CMP})`,
    allow: [SEAM, ...PAYMENT_LIBS],
    why: 'behavioural forks belong in capabilities.ts, not in scattered comparisons',
  },
  {
    id: 'stripe-negated-compare',
    name: "negated 'stripe' comparison outside the seam (the complement spelling of the same fork)",
    pattern: `((!==|!=)\\s*${Q}stripe${Q}|${Q}stripe${Q}\\s*(!==|!=))`,
    allow: [SEAM, ...PAYMENT_LIBS],
    why: "`x !== 'stripe'` is `x === 'square'` wearing a hat",
  },
  {
    id: 'provider-field-compare',
    name: 'payment_provider field compared to a string literal outside the seam',
    pattern: `payment_?[Pp]rovider\\s*${CMP}\\s*${Q}`,
    allow: [SEAM, ...PAYMENT_LIBS],
    why: 'route on resolvePaymentProvider()/capabilities, never on the raw column',
  },
  {
    id: 'provider-string-membership',
    name: "'square' matched by substring/membership instead of compared",
    pattern: `\\.(includes|startsWith|endsWith|indexOf|search|match|test)\\(\\s*${Q}square${Q}`,
    allow: [SEAM, ...PAYMENT_LIBS],
    why: 'same fork, spelled as a string search',
  },
  {
    id: 'provider-switch-case',
    name: 'switch/case on a provider name outside the seam',
    pattern: `case\\s+${Q}(square|stripe)${Q}\\s*:`,
    allow: [SEAM, ...PAYMENT_LIBS],
    why: 'a case arm is a fork; put it behind capabilities.ts',
  },
  {
    id: 'provider-literal-alias',
    name: 'provider name aliased to a local constant outside the seam',
    // `const SQUARE_PROVIDER = "square"` defeats every literal rule above.
    pattern: `(const|let|var)\\s+[A-Za-z_$][A-Za-z0-9_$]*\\s*(:[^=]+)?=\\s*${Q}(square|stripe)${Q}`,
    allow: [
      SEAM,
      ...PAYMENT_LIBS,
      // Path-pinned exemption. This portal hook cannot import the seam's
      // SQUARE const (Next.js app <-> Deno edge boundary — it already
      // re-declares TENANT_PROVIDER_COLUMNS locally for the same reason) and
      // it drives Square settings UI state, not a money path. Pinned to the
      // one file so the exemption cannot spread.
      'apps/portal/src/hooks/use-square-connection.ts',
    ],
    why: 'aliasing the literal hides the fork from every other rule here',
  },
  {
    id: 'dynamic-provider-eq',
    name: '.eq(payment_provider, <computed>) — provider chosen at runtime',
    pattern: `\\.eq\\(\\s*(['"]payment_provider['"]|PROVIDER_COLUMN)\\s*,`,
    allow: [SEAM],
    // grep cannot tell `.eq(PROVIDER_COLUMN, SQUARE)` from `.eq(PROVIDER_COLUMN, x)`.
    // Only a constant second argument is sanctioned; anything computed can
    // evaluate to the wrong provider and re-scope a cron sweep at runtime.
    refine: (body) => {
      const arg = body.slice(body.indexOf('.eq(') + 4).split(',').slice(1).join(',');
      const value = arg.slice(0, arg.lastIndexOf(')') === -1 ? arg.length : arg.lastIndexOf(')'));
      return !/^\s*(['"](stripe|square)['"]|STRIPE|SQUARE)\s*$/.test(value);
    },
    why: "only the literals 'stripe'/'square' or the seam's STRIPE/SQUARE consts may be the value",
  },
  {
    id: 'resolver-alias',
    name: 'banned resolver alias',
    pattern: `function (getTenantProvider|providerFor|resolveProvider|getPaymentProvider|whichProvider)\\b`,
    allow: [],
    why: 'resolvePaymentProvider() in resolve.ts is the only resolver; it fails open to Stripe',
  },
];

/**
 * grep, without a shell. execSync + string interpolation was the old shape and
 * it had two teeth-removing bugs: a backtick in a pattern would have opened a
 * command substitution, and `|| true` turned grep's exit 2 (malformed regex,
 * unreadable root) into "no violations found" — the rule then printed "ok".
 * Here exit 1 means no match and anything higher throws.
 */
function grep(pattern) {
  try {
    return execFileSync(
      'grep',
      ['-rnE', pattern, ...ROOTS, '--include=*.ts', '--include=*.tsx',
       '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=dist'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    if (err.status === 1) return '';
    throw new Error(
      `grep failed (exit ${err.status}) for pattern ${pattern}\n${err.stderr || ''}`,
    );
  }
}

/** `path:line:body` -> body, or null when the line is prose about the rule. */
function codeBody(line) {
  const body = line.replace(/^[^:]+:\d+:/, '').trim();
  // A rule about code must never fire on prose describing the rule.
  if (body.startsWith('*') || body.startsWith('//') || body.startsWith('/*')) return null;
  return body;
}

export function violationsFor(rule) {
  return grep(rule.pattern)
    .split('\n')
    .filter(Boolean)
    .filter((l) => !l.includes('node_modules'))
    .filter((l) => !rule.allow.some((a) => l.startsWith(a)))
    .filter((l) => {
      const body = codeBody(l);
      if (body === null) return false;
      return rule.refine ? rule.refine(body) : true;
    });
}

function main(argv) {
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt === -1 ? null : argv[onlyAt + 1];
  if (only && !RULES.some((r) => r.id === only)) {
    console.error(`[predicates] unknown rule id: ${only}`);
    return 1;
  }

  const rules = only ? RULES.filter((r) => r.id === only) : RULES;
  let failed = false;
  for (const rule of rules) {
    let lines;
    try {
      lines = violationsFor(rule);
    } catch (err) {
      // An unrunnable rule is a failed rule, never a passing one.
      console.error(`[predicates] ERROR  ${rule.id}: ${err.message}`);
      failed = true;
      continue;
    }
    if (lines.length) {
      console.error(`\n[predicates] ${rule.name} — ${lines.length} violation(s):`);
      console.error(`             why: ${rule.why}`);
      for (const l of lines) console.error('  ' + l);
      failed = true;
    } else {
      console.log(`[predicates] ok  ${rule.id.padEnd(26)} ${rule.name}`);
    }
  }
  return failed ? 1 : 0;
}

// Importable by check-meta.mjs without running the scan.
const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
