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

Those four cover the MONEY path. Six more cover the rest of the surface — the
servicing endpoints and the partner-onboarding side, which were listed below as
"the obvious next files" and now exist:

| File | Layer | Runs by default | What it proves |
|---|---|---|---|
| `verify-credentials.test.ts` | 1 + 2 | **yes** (Layer 1) | whether "verified" means anything: the trim, the test-mode short circuit and the `platform: true` flag that says the check did not happen — plus the shipped token cache, **executed** |
| `view-policy.test.ts` | 1 + 2 | **yes** (Layer 1) | the read-through to Insillion: `status !== 0` is a failure at HTTP 200, and the function writes nothing (which is what puts it on the reads rung) |
| `download-pdf.test.ts` | 1 + 2 + 3 | **yes** (Layers 1 and 3) | the certificate: guard order, the token kept out of the logs, and the **byte arithmetic** — the shipped loop is lifted and run over 300 KB, and the base64 expectations are hand-typed |
| `probe-pdf.test.ts` | 1 + 3 | **yes** | what the 28-endpoint diagnostic is, that nothing calls it, that every URL follows the tenant's mode, and its `couldBePdf` classifier, **executed** |
| `grade-quiz.maths.test.ts` | 1 + 3 | **yes** | the pass mark. `score / total >= 0.8` at the exact boundary, the strict answer comparison, and the auth order that keeps the answer key server-side |
| `partner-review.test.ts` | 1 + 2 | **yes** (Layer 1) | the partner gate above every write, the tenant taken from the submission, and the deliberate flip to live mode **before** verification |

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

**The servicing cases sit at rung 1 plus 3b, which looks odd and is not.**
`bonzah-view-policy` and `bonzah-download-pdf` spend nothing and write nothing,
so they never reach rung 2 — but they are called THROUGH our edge function,
which picks the Bonzah host from `tenants.bonzah_mode` server-side. `sandbox.ts`
can refuse a hostname when the test does the calling; here it cannot see the
hostname at all. A live-mode fixture tenant would send them at production
insurance and no guard in this folder would notice. So the same human
declaration the money gate needs is required for a read, and unset is refused —
`bonzahServicingGate()` in `servicing.ts`, which calls `liveStatus()` first and
inherits its production-database throw.

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
| `D247_LIVE_BONZAH_POLICY_ID` | Bonzah's OWN policy id (`bonzah_insurance_policies.policy_id`, not our row id) for the `bonzah-view-policy` read. |
| `D247_LIVE_BONZAH_PDF_ID` | one of the values in `coverage_types.pdf_ids`, for the `bonzah-download-pdf` read. |
| `D247_LIVE_PORTAL_JWT` | already used by the Stripe folder; here it is a REAL USER for `bonzah-grade-quiz` (the anon key resolves to no user and only reaches the 401) and for `bonzah-partner-review`'s 403. Point it at a NON-partner to exercise the 403 itself. |

## What is NOT here, and why

- **The Bonzah addendum / compliance copy** (`_shared/bonzah-addendum.ts`,
  `lib/bonzah-compliance.ts`) — legal text, not payloads.
- **`summarize-bonzah-submission`, `send-bonzah-*`** — the rest of the
  partner-onboarding side. `bonzah-partner-review` fires the two emails
  fire-and-forget, and that it does so is asserted there; what the emails
  contain is not.
- **A live case for `bonzah-probe-pdf`.** Ten of its twenty-eight probes are
  POSTs at Insillion endpoints with bodies we invented, on the tenant's own
  authenticated session. There is no rung at which firing those is a test, and a
  gate nobody would ever be right to open teaches the next reader that the gates
  are decoration. Its classifier is executed offline instead, and the count that
  drives this decision is asserted so adding endpoints re-opens the question.
- **A live case for `bonzah-partner-review`'s happy paths.** Every one of them
  writes live insurance credentials onto an operator's tenant. Only the 401 and
  the 403/400 run live, and both stop before the first write.
- **A live case for `bonzah-verify-credentials` in LIVE mode.** It is a login
  attempt at production insurance and Insillion counts failures. Only the
  test-mode short circuit runs live, and it contacts Bonzah not at all — which
  is the property being asserted.
- **Anything that renders.** Node, not jsdom, like the rest of this suite.

## One invariant all six servicing files share

Each of the six asserts that its function is **absent from `supabase/config.toml`**.
`verify_jwt` defaults to true, so that absence IS the gateway's authentication —
and adding a `[functions.x]` block with `verify_jwt = false` is a one-line change
with no other visible effect. Every one of these functions either takes a
`tenant_id` off the request body and reads it with the SERVICE ROLE client, or
holds an answer key, or writes live insurance credentials onto an operator's
tenant. The assertion is derived from the file, not remembered.

## WATCHDOG cases — a defect that is tracked, never blessed

Six cases are labelled `WATCHDOG`. They exist because of one rule: **no test may
encode broken behaviour as expected**. A watchdog does the opposite — it pins the
exact footprint of a defect that is real and not yet fixed, says so in its
failure message, and **converts itself into the positive assertion the moment the
fix lands**. Each is an `if (fixed) { assert the correct behaviour; return }`
followed by the pin, so a fix turns the case green through the top branch and a
REGRESSION of the fix turns it red.

What they are currently tracking (all six are findings, reported, not accepted):

| where | the defect |
|---|---|
| `verify-credentials` | `getBonzahTokenForCredentials` caches Bonzah tokens under the **username alone** and returns the cached token before comparing anything, so a WRONG password submitted within the 14-minute TTL of a good one is reported `valid: true` — and both callers then persist it. Proved by executing the shipped function. |
| `verify-credentials` | `bonzah-settings.tsx` (the older Settings component, still shipped) reads `valid` but not `platform`, so it prints "credentials have been verified and saved" for a test-mode short circuit that verified nothing. The integrations panel gets this right; the two callers disagree. |
| `view-policy` | the portal's "Refresh policy" button invokes a function that persists nothing, throws away the returned policy, invalidates two React Query keys and reports "Latest policy data has been fetched from Bonzah". Nothing changed. |
| `view-policy` | the function is JWT-gated only, takes `tenant_id` off the request body and reads it with the SERVICE ROLE client. Any authenticated user — including a booking-side customer — can name another tenant's id. |
| `download-pdf` | `policy_id` is optional in the request type and mandatory at runtime; `InsuranceTimeline.tsx` invokes the download without checking it first. |
| `download-pdf` | the `%PDF`-in-a-text-body fallback reads a BINARY response with `.text()` and re-encodes it. 11 PDF bytes become 15: every byte that is not valid UTF-8 becomes `EF BF BD`. The header survives, so the file downloads cleanly and then will not open. |
| `partner-review` | the approve path flips `bonzah_mode` to live and then verifies. Both rollbacks are on ANSWERS; a THROWN verification (network, cold start, unparseable 5xx) skips them and leaves the tenant live with no live credentials, which breaks servicing for policies already sold. |

There are **no `test.todo` placeholders**. Every case named here is implemented,
and Layer 1 and Layer 3 of all of them run on the default, offline pass.

## Running it

```bash
npm run test:spine                                   # everything, offline
npm run test:spine:one -- "bonzah/premium-maths"     # one group
npm run test:spine:one -- "bonzah/download-pdf"      # one of the servicing files
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
