# `integrations/bonzah`

## Why this folder exists

The model is the spine and the integrations around it, and Bonzah is one of the
four named on the whiteboard:

```
                    Bonzah
                      |
        Square  ---  SPINE  ---  Stripe
                      |
                    INSHUR
```

`tests/spine/` is the spine. This folder is the Bonzah ring. When its cases pass,
*"hamari jo individual integration hai, yeh intact hai"*.

## The split this folder is built around

Ghulam divided testing in two this morning, and the division is why there are
four files rather than one:

> "**FUNCTIONAL** test hai, aur phir **MATHS** wale test hain… maths wale test
> bade important hain" — because "jab payments layenge toh maths aana shuru ho
> jayega".

Bonzah is where that already bites. A Bonzah policy is bought out of the
operator's **prepaid balance**, priced per 24 hours, and billed to the customer
through Stripe — so a wrong number here is not a wrong pixel, it is an operator
paying the difference on every policy they sell.

| File | Layer | Runs by default | What it proves |
|---|---|---|---|
| `premium-maths.test.ts` | 3 (pure) | **yes** | the app agrees with **itself**: the rate card, `calculateDays`, the rounding rule, the two copies of the arithmetic, and that 30-day chunking does not change the price |
| `balance-maths.test.ts` | 3 (pure) | **yes** | the other arithmetic: which balance is spendable, and the low-balance alert thresholds |
| `functional.test.ts` | 1 + 2 | **yes** (Layer 1) | payloads, guards, and the **order** guards run in — everything that decides *whether* a policy is sold |
| `premium-parity.test.ts` | 1 + 2 | **yes** (Layer 1 only) | the app agrees with **Bonzah** — the one that catches a stale rate card |

### The two maths files are not interchangeable, and neither is optional

```
premium-maths.test.ts     we agree with OURSELVES      always runs, no network
premium-parity.test.ts    we agree with BONZAH         opt-in, sandbox only
```

The day Bonzah reprices CDW from $26.95 to $28.95, **every assertion in
`premium-maths.test.ts` still passes**. The app would be perfectly
self-consistent and quoting last year's price to every customer. Only the parity
file can see that. Equally, agreeing with Bonzah on one five-day window says
nothing about whether the multiplication holds at 30 days or across a DST
boundary — only the maths file can see that. Both, or neither is worth much.

## About the "200"

The maths test's shape came from a worked example on the whiteboard:

> "agar woh Bonzah ki pehli wali insurance leta hai aur uske din hote hain
> **PAANCH**, toh uska **TOTAL 200** banna chahiye" — drawn as `vitest 1 === 5 === 200`

**The 200 is illustrative. It is not a real expected value**, and it is not
encoded anywhere in this folder. The live rate card is:

| coverage | per 24h | × 5 days |
|---|---|---|
| CDW | 26.95 | 134.75 |
| RCLI | 23.18 | 115.90 |
| SLI | 20.18 | 100.90 |
| PAI | 6.90 | 34.50 |
| **all four** | **77.21** | **386.05** |

Nothing equals 200 at five days. The five-day case in `premium-maths.test.ts` is
his case with the real numbers; asserting 200 would have failed, and "fixing" the
code to match a sketch would have broken pricing for every operator selling
Bonzah.

## How the maths tests avoid being vacuous

A maths test that computes its expectation with the same expression the source
uses proves only that somebody typed one formula twice, and it stays green when
the formula changes. So the two sides come from different places:

- **EXPECTED** — every number is a **literal**, worked out by hand from the
  published per-24h card and typed into the test file. There is no `RATES.CDW *
  days` anywhere in `premium-maths.test.ts`.
- **ACTUAL** — `rate-card.ts` lifts the **real expressions** out of
  `supabase/functions/bonzah-*/index.ts` and **executes** them.
  `body.cdw_cover ? Math.round(RATES.CDW * days * 100) / 100 : 0` runs verbatim,
  with the rate read from the shipped table.

Change `CDW: 26.95` to `27.95`, swap `Math.round` for `Math.floor`, drop a
coverage out of the total, or rename `cdw_cover`, and the file goes red. That is
the same argument `helpers/edge-contract.ts` makes for parsing a function's
request shape instead of listing its fields, applied to the money.

`rate-card.ts` throws — loudly, naming the file and what it looked for — rather
than returning a default when it cannot find an expression. A silent zero would
make every assertion pass against nothing, which is worse than a red build.

## Layer 2 — what it costs to enable, rung by rung

Bonzah is **not** Stripe. There is no test card that makes a mistake free: a
policy is bought out of a prepaid balance and there is no `DELETE`. So the ladder
is one rung stricter than the Stripe folder's, and on top of it every single HTTP
call this folder makes re-checks the hostname.

| rung | variable | unlocks |
|---|---|---|
| 1 | `D247_LIVE_TESTS=1` | the read-only probes. **Inherits `helpers/live-call.ts`'s production-Supabase refusal**, which is a hard throw with no override. |
| 2 | `D247_LIVE_ALLOW_WRITES=1` | the sandbox **quote** cases, and `bonzah-get-balance` (which is not read-only — under threshold it inserts a reminder, inserts a notification per admin, and emails the operator). |
| 3 | `D247_LIVE_ALLOW_MONEY_MOVEMENT=1` | `bonzah-confirm-payment` only. **This buys a policy.** |
| 3b | `D247_LIVE_BONZAH_MODE=test` | required alongside it. A declaration, not a detection — see below. Unset is refused. |

**Why 3b exists.** The Supabase guards prove which *database* the run points at.
They prove nothing about Bonzah: `tenants.bonzah_mode` is a **per-tenant column**,
so a perfectly non-production Supabase project can hold a tenant wired to
Bonzah's live API — and `getTenantBonzahCredentials` reads that column, not any
variable here, when it chooses between `bonzah.sb.insillion.com` and
`bonzah.insillion.com`. Exactly the argument `D247_LIVE_STRIPE_MODE` exists for.

### The sandbox-only refusal

> "jo test develop kar rahe hain woh **sandbox mein hi**."

`sandbox.ts` refuses any Bonzah URL that is not exactly
`bonzah.sb.insillion.com` — exact hostname equality, plus a substring check for
the live host, re-run on every call rather than once at the gate. The two
hostnames are **read out of the shipped `getBonzahApiUrl`**, so the guard cannot
end up guarding a hostname the app no longer uses. There is no override flag.

That refusal is itself asserted offline, in `premium-parity.test.ts`'s Layer 1
block, including the suffix-attack and host-in-the-path cases — so it is checked
before anybody turns the flags on.

### Variables this folder adds

| variable | meaning |
|---|---|
| `D247_LIVE_BONZAH_USERNAME` / `_PASSWORD` | Bonzah **sandbox** credentials. Never inferred, never read from the app's own env. |
| `D247_LIVE_BONZAH_SANDBOX_URL` | optional. Defaults to the sandbox constant lifted from the shipped client. Unlike `D247_LIVE_FUNCTIONS_URL` it *may* default, because the only permitted value is the sandbox and anything else is refused — defaulting is the fail-safe direction here, not the dangerous one. |
| `D247_LIVE_BONZAH_TENANT_ID` | a tenant to read a balance for, and to quote against. For the quote case it must have `bonzah_sandbox_override = true`, or `getBonzahSellability` refuses every test-mode sale — deliberately — and answers 403 instead of a premium. |
| `D247_LIVE_BONZAH_RENTAL_ID` / `_CUSTOMER_ID` | rows for the end-to-end `bonzah-create-quote` case to hang a policy off. |
| `D247_LIVE_BONZAH_POLICY_RECORD_ID` | **one-shot.** The `quoted` policy row the money case buys. Confirming it issues a policy and draws the balance down; a second run gets `already_processed`. |

## What is NOT here, and why

- **`bonzah-download-pdf`, `bonzah-view-policy`, `bonzah-probe-pdf`,
  `bonzah-verify-credentials`** — document servicing and a credential check.
  Named in CLAUDE.md, no arithmetic, and none of them can sell or spend. They are
  the obvious next files.
- **The Bonzah addendum / compliance copy** (`_shared/bonzah-addendum.ts`,
  `lib/bonzah-compliance.ts`) — legal text, not payloads.
- **`bonzah-grade-quiz`, `bonzah-partner-review`, `summarize-bonzah-submission`,
  `send-bonzah-*`** — the partner-onboarding side. A different surface that
  shares a prefix.
- **Anything that renders.** Node, not jsdom, like the rest of this suite.

There are **no `test.todo` placeholders**. Every case named here is implemented,
and Layer 1 and Layer 3 of all of them run on the default, offline pass.

## Running it

```bash
npm run test:spine                                   # everything, offline
npm run test:spine:one -- "bonzah/premium-maths"     # one group
npm run test:spine:one -- "bonzah"                   # the whole folder
```

`-t` works cleanly here: unlike the spine's 01..05 chain, these files stand alone.

Two cases are timezone-aware and say so when they skip or soften:
`splitDateRange` mixes local-midnight construction with `toISOString()`, and
`formatDateForBonzah` reads local date parts off a UTC-midnight `Date`. Both are
correct in the deployed Deno runtime, which is UTC; both are a day out west of
it. The exact-date assertions are gated on the runtime's offset — every
premium-affecting invariant around them is asserted unconditionally. `TZ=UTC npm
run test:spine` runs the gated ones too.
