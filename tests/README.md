# `tests/` — the spine suite

## Quick start — the commands

```bash
# Everything. No network, no config, ~1s. This is the one for CI.
npm run test:spine

# Re-run on save while you work.
npm run test:spine:watch

# One group by name (-t is a substring match on the describe/it text).
npm run test:spine:one -- "process-refund"
```

`-t` works cleanly on the INTEGRATION tests, which stand alone. It does not do
what you expect on the onboarding SPINE steps, and that is the chain behaving
correctly rather than a bug: those five files run in order and each one skips if
an earlier step did not pass, so filtering to step 02 leaves step 01 un-run and
02 skips itself with "chain stopped at 01". To look at one spine step, run the
whole chain — it takes about a second — and read the step you care about.

That is the whole setup for Layer 1. There is nothing to install and nothing to
configure — the contract tests read the edge functions' own source, so they need
no database, no keys and no network.

### If you want Layer 2 as well (the live "does it give me 200" tests)

```bash
cp tests/.env.example tests/.env.local     # then fill in D247_LIVE_ANON_KEY
npm run test:spine:live
```

`tests/.env.local` is gitignored. Every variable is documented in
`tests/.env.example`, including which ones widen what the suite is allowed to
do — writes and money movement each need their own switch.

**Pointing this at production is refused, deliberately and with no override.**
`hviqoaokxvlancmftwuo` is the live database, and Layer 2 calls `signup-begin`
(which mints a real `auth.users` row) and `signup-provision` (which creates a
real tenant). The run aborts before the first fetch. See section 6.

Without `tests/.env.local`, `test:spine:live` fails on the missing file rather
than quietly running the default suite and reporting green — a live run that
silently was not live is the worst outcome available here.


Automated tests for Drive247's onboarding spine. Written to one specific brief,
from one specific meeting, and it is worth stating that brief before the
instructions, because every design decision below follows from it.

```bash
npm run test:spine          # the whole suite. No env needed. No network.
npm run test:spine:watch    # same, in watch mode
```

---

## 1. The model: a spine, and integrations around it

> "kisi bhi application ki ek **SPINE** hoti hai, aur us spine ke ird-gird
> integrations hoti hain … humne jo test banane hain wo **SPINE ke upar** banane
> hain, abhi shuru-shuru mein. phir eventually hum inke ird-gird bhi test bana
> rahe honge."

```
                       Bonzah
                          |
         Square  ------  SPINE  ------  Stripe
                          |
                       INSHUR
```

`spine/` is the spine. `integrations/` is the ring around it, one folder per
third party. The Stripe folder exists because the structure was agreed
(Haseeb proposed it, Ghulam: *"bilkul exactly, waise hi karenge hum"*), and it
holds the three cases that conversation named — refund, partial payment,
checkout — and nothing else. See §7.

## 2. What these tests are FOR

Not coverage. Not confidence-in-general. One job:

> A small change to the spine otherwise forces a manual re-test of the whole
> spine **and** every integration's flows, because a change to one or two edge
> functions can break any of them. That needs a separate person, and
> *"feature ek din mein ban gaya, ab teen din hum kya kar rahe the?"* is
> impossible to justify.

So the tests exist to make a **spine change safe to ship**. Anything that does
not serve that does not belong in this folder.

## 3. What they assert, and what they deliberately ignore

> "at the end sirf **DO HI CHEEZEIN** hoti hain, kisi bhi multi-billion
> application mein bhi: **PAYLOADS** hain aur **APIs** hain. UI agar phatta hai
> to phat jaaye, uski khair hai — lekin hamare payloads aur function kharab nahi
> hone chahiye."

Payloads and APIs. Nothing renders in this suite; the environment is `node`, not
`jsdom`.

**No browser automation. No Playwright.** Explicitly ruled out:

> "obviously hum browser wala test nahi chala rahe — jo browser khol ke uske
> andar baari baari jaata hai aur wo cheez karta hai. wo test carry nahi ho
> payenge, humse bade mushkil ho jaayenge."

## 4. The chain — stop at the first thing that is not 200

The whiteboard, verbatim:

```
plan select.  --- 99
account --- [password, work] ---> edge functionn. --- 200
paymnet --- checkout ---> {999} --- 200
```

> "uska result bhi 200 aana chahiye — magar 200 nahi aayega to **HUM YAHAN PAR
> ROK DENGE**."

The files are numbered because that numbering **is** the spec:

```
spine/onboarding/
  01-plan-select.test.ts     seed the run with one fixed amount ($99 / 9900c)
  02-account.test.ts         signup-begin
  03-slug-check.test.ts      signup-slug-check
  04-payment.test.ts         signup-payment-intent
  05-provision.test.ts       signup-provision
```

The first step that fails **breaks the chain**, and every later step is *skipped*
with a message naming what broke it — one red line in the right place, instead of
five red lines for one broken thing. `helpers/chain.ts` holds that state, which
is why `vitest.config.ts` pins the runner to one fork, no file parallelism, no
isolation, and an alphabetical sequencer. Those four settings are load-bearing,
not tidiness: with any of them off, each file gets a fresh module registry and
the chain silently forgets.

## 5. The two failure modes — every message says which one it is

> **(a)** A developer legitimately changed a field. *"maine slug nikaal di, lekin
> test ka payload mein slug ja raha hai"* — the test fails and the **dev** comes
> and fixes the test payload. Expected, healthy.
>
> **(b)** The edge function itself broke. *"400 de raha ho, 401 de raha ho"* —
> the test fails and that is a real bug. *"aap in anyway isse aage badh hi nahi
> paoge."*

A failure message that does not say which of these it is has failed at its job.
So every failure in this suite names the mode, the field, and the side that
moved. A real one, from a run where `slug` was removed from the declared payload:

```
CONTRACT DRIFT — signup-provision (spine step 05-provision)

  signup-provision reads 1 field(s) that nothing sends:
    - slug  (declared-type, member-access)

  WHICH SIDE MOVED: the EDGE FUNCTION grew a field, or the CLIENT dropped one.
  apps/web/.../onboarding-provider.tsx (buildProvisionRequest) builds the
  payload; supabase/functions/signup-provision/index.ts reads it.

  THIS IS FAILURE MODE (a): a developer changed a field. It is the healthy,
  expected failure. Nothing is broken for a paying operator right now — fix
  whichever side is wrong and the build goes green.

  It is NOT failure mode (b) — 'the edge function itself is returning 400/401'.
  A contract test never touches the network and cannot see a status code.
```

Layer 2 does the same job for live responses: `classifyLive()` in
`helpers/live-call.ts` reads the status and the error code and reports mode (a)
for a field-shaped 400, mode (b) for a 401/404/5xx or an unexplained 400.

---

## 6. THE TWO LAYERS, AND WHY

This is the one place where the implementation goes beyond what was asked, and
the reason matters more than the mechanism.

**`V2_PLAN.md` §0:**

> "There is no staging. You are working on `main`, in the repo that deploys,
> against the production database that ~32 paying operators are running their
> businesses on right now."

And these endpoints are not read-only:

| function | what a 200 costs |
|---|---|
| `signup-begin` | calls `auth.admin.createUser` — **mints a real `auth.users` row.** Its own header: *"once this returns 200 the auth user exists and nothing in the UI can delete it."* |
| `signup-payment-intent` | creates a **real Stripe Customer and Subscription** on the platform account |
| `signup-provision` | **creates a real tenant** — plus a head-admin user, seeded CMS pages, and subscription records |
| `signup-slug-check` | nothing. A `SELECT` and a verdict. |

A naive "POST it and assert 200" suite is therefore a machine for manufacturing
junk operators on a live business database, once per CI run, for ever. That is
not what was asked for and it is not shippable. So:

### Layer 1 — CONTRACT tests. Default. No network. Always run.

These catch failure mode (a), which is the common one. They assert that the
payload the **frontend builds** still matches the fields the **edge function
reads**.

The important detail: the function's side is **parsed out of its own source**
(`helpers/edge-contract.ts` reads `supabase/functions/<fn>/index.ts` and works
out every field it can read off the body). Only the frontend's side is written
down by hand. A test that hardcodes *both* sides only proves that one developer
typed the same list twice; deriving one side means a field removed from the
function shows up on the next run with nobody having remembered to update a list.

Layer 1 needs no env, no keys, no network, and finishes in under a second.

### Layer 2 — LIVE STATUS tests. Opt-in. Skipped unless enabled.

These are the literal "does it give me a 200". They:

- **skip cleanly** (never fail) when not enabled, so the default run is green
- **refuse to run, loudly** if the target is the production project ref
  `hviqoaokxvlancmftwuo` — a hard throw, not a warning, with **no override flag**
- are honest, in each test, about which ones create rows

Three independent production checks, because one is not enough:

0. **the production ref appearing anywhere at all** in the URL, in
   `D247_LIVE_PROJECT_REF`, or inside the decoded payload of either JWT. Plain
   substring, case-insensitive, and it runs *before* any ref is resolved — so
   `https://db.hviqoaokxvlancmftwuo.supabase.co/...` or an upper-cased prod host
   is refused even when `D247_LIVE_PROJECT_REF` claims something innocent.
1. the project ref parsed canonically out of `D247_LIVE_FUNCTIONS_URL`
2. the project ref inside the `D247_LIVE_ANON_KEY` JWT payload — a custom domain
   or a proxy can hide the ref from the URL, but the key you authenticate with
   cannot lie about which project issued it

A target that none of the checks can identify is **refused as unsafe**, not waved
through. And `D247_LIVE_TESTS=1` with no target set is a hard error, not a
default — guessing a target is exactly how a run ends up on production.

`signup-slug-check` is the read-only one, and it is what proves the harness
works end to end.

### Enabling Layer 2

```bash
D247_LIVE_TESTS=1 \
D247_LIVE_FUNCTIONS_URL=https://<non-prod-ref>.supabase.co/functions/v1 \
D247_LIVE_ANON_KEY=<that project's anon key> \
npm run test:spine
```

| variable | meaning |
|---|---|
| `D247_LIVE_TESTS=1` | turn Layer 2 on. Without it, every live test skips. |
| `D247_LIVE_FUNCTIONS_URL` | the target. **Required.** Never inferred. |
| `D247_LIVE_ANON_KEY` | that project's anon key. Strongly recommended — it is the second production guard. |
| `D247_LIVE_SESSION_JWT` | a signed-in signup user's access token. Unlocks the one real `200` case (`signup-slug-check`). |
| `D247_LIVE_PROJECT_REF` | only needed for a non-`*.supabase.co` host, so the guard has something to check. It can only ever *narrow* the guard — it cannot excuse a URL that mentions the production ref. |
| `D247_LIVE_ALLOW_WRITES=1` | **second, separate flag.** Unlocks `signup-begin`'s happy path, which creates a permanent auth user. Leave it off in CI. |
| `D247_LIVE_ALLOW_MONEY_MOVEMENT=1` | **third, separate flag.** Unlocks the Stripe cases that move money at a third party. See below. |
| `D247_LIVE_STRIPE_MODE=test` | Required alongside it. A declaration, not a detection — unset is refused. |

### The third rung — money

`ALLOW_WRITES` covers rows we own: an `auth.users` row, a tenant row. Junk, on a
project we chose, deletable with one SQL statement.

A Stripe refund is not that. It is a write to a THIRD PARTY with no `DELETE` —
once `refunds.create` returns, the money is on its way to a cardholder and
nothing in this repository can call it back. *A refund test that runs against a
real charge is not a test of a refund; it is a refund.* So the Stripe money
cases need a third yes, plus one thing the Supabase guards cannot supply:

`tenants.stripe_mode` is a **per-tenant column**. A perfectly non-production
Supabase project can hold a tenant wired to live Stripe keys, and
`process-refund` reads that column — not any variable here — when it picks which
Stripe account to refund from. So `D247_LIVE_STRIPE_MODE=test` is a human
declaration, it is refused when unset (fail closed, V2_PLAN.md §2), and it can
only ever *narrow*: `liveStatus()` has already run and already thrown by the
time it is read, so nothing about Stripe can excuse a production Supabase ref.

The one thing that does *observe* the real Stripe mode is the checkout case:
`signup-payment-intent` hands back the publishable key it actually built the
subscription with, and confirmation stops dead unless that key starts with
`pk_test_`.

Fixtures (`D247_LIVE_PORTAL_JWT`, `D247_LIVE_REFUND_RENTAL_ID`, …) are never
inferred, are checked before the first HTTP call, and are **one-shot** — the
money cases spend a real balance and skip on a second pass. The full list is in
`integrations/stripe/README.md`.

`scripts/db-switch.mjs` already knows a non-production branch clone
(`ksmreaadhbirzakkxqrq`). That is the intended target.

Nobody has run Layer 2 against it yet — there are no keys for that project in
this repo — so there is no "expected" live tally to quote here, and inventing one
would be worse than leaving the gap. That applies to the Stripe money cases
too: they are written, they are gated, and they have never been executed.

What has been run and verified is the default: **35 passed, 15 skipped, 0 todo**,
and the "no network" claim is not an assumption — the same run passes unchanged
inside an empty network namespace:

```
$ unshare -rn npx vitest run --config tests/vitest.config.ts
 Test Files  8 passed (8)
      Tests  35 passed | 15 skipped (50)
```

The gate ladder has been exercised in the other direction too, all of it
refusing before any socket is opened: a money run aimed at the production ref,
`ALLOW_MONEY_MOVEMENT` without `ALLOW_WRITES`, without `STRIPE_MODE`, without
`D247_LIVE_TESTS`, and with the full ladder but no fixture.

---

## 7. Scope

> "yeh automatic test sirf abhi sirf yeh **ONBOARDING FLOW** tak hi honge."

Onboarding only. `integrations/stripe/` holds the three cases that conversation
named out loud — **refund, partial payment, checkout** — because the folder shape
was agreed, and it stops there. It is not a payments-surface suite: pre-auths,
installments, Connect onboarding, webhook replay and disputes are all listed as
future files in `integrations/stripe/README.md` and none of them is written.

There are no `test.todo` placeholders left anywhere in `tests/`. The three cases
are implemented in both layers, and Layer 1 of all of them runs on the default,
offline pass.

## 8. Layout

```
tests/
  README.md                     this file
  vitest.config.ts              node env, single fork, no isolation, 01..05 order
  helpers/
    edge-contract.ts            parse an edge function's read fields from source
    live-call.ts                the gated caller + the production refusal, and
                                the three rungs: tests -> writes -> money
    stripe-live.ts              refund fixtures, the balance probe, and the two
                                publishable-key Stripe calls that stand in for
                                the browser's card confirmation
    chain.ts                    stop-on-first-failure sequencing
  spine/
    onboarding/
      01-plan-select.test.ts
      02-account.test.ts        signup-begin
      03-slug-check.test.ts     signup-slug-check
      04-payment.test.ts        signup-payment-intent
      05-provision.test.ts      signup-provision
  integrations/
    stripe/
      README.md
      checkout.test.ts          + the money cases: confirm, and decline
      partial-payment.test.ts   + the money cases (this file spends the fixture)
      refund.test.ts            + one live case that needs no money flag at all
```

`integrations/` files are NOT on the spine chain — they run independently, and
alphabetically, which is why `partial-payment` (which drains its fixture) sorts
before `refund` and why the full-refund case can be pointed at a rental of its
own.

## 9. Adding a step, or a new integration

- **A new field in an existing payload** — add it to that step's `CONTRACT.payload`.
  If the function does not read it, the test tells you so by name.
- **A field the function reads but the browser deliberately does not send** — add
  it to `serverOnlyOptional` *with a reason*. Every excuse in `05-provision` has
  one, and a stale excuse for a field the function no longer reads is itself a
  failure: it would hide the next real drift behind it.
- **A new spine step** — add its id to `SPINE_ORDER` in `helpers/chain.ts` and
  number the file to match. The number is the order.
- **A new integration** — a folder under `integrations/`, a README saying what
  belongs in it, and one file per case.
- **A function whose body-parsing shape the helper does not know** — teach the
  parser. `readEdgeFunction` throws on an unknown shape rather than returning an
  empty field set, on purpose: an empty set would make every assertion against
  that function pass for the wrong reason, which is worse than a red build.

> **Correction to the bullet above, for a SECOND spine.** `SPINE_ORDER` in
> `helpers/chain.ts` is one flat union, and `reasonToSkip()` requires *every*
> earlier entry to have passed. So adding rental step ids to it would make the
> rental spine skip whenever an **onboarding** step failed — two unrelated
> journeys chained into one. `SpineChain` is also not exported, so a second
> chain cannot be instantiated today. Until that is fixed, files under
> `spine/rental/` are **standalone**: they share fixtures, not chain state.
> Follow the bullet above only for new steps of the *onboarding* spine.

## 10. Naming convention

The team lead's rule: *"every test — I won't read it, but it should make sense."*
Titles are also harvested into [TEST-CATALOGUE.md](./TEST-CATALOGUE.md), so a
title is documentation, not a label. Three rules.

**1. A test title is a lowercase sentence about BEHAVIOUR that reads correctly
after the word "it".** Describe what the system does, from the system's point of
view — not what the test does.

```
GOOD  it("refuses a refund larger than the remaining refundable balance")
GOOD  it("falls back to Stripe when the tenant row cannot be read")
GOOD  it("counts nights, not calendar days touched: Mar 1 -> Mar 4 is three days")
BAD   it("test refund cap")                    <- not a sentence
BAD   it("should work correctly")              <- says nothing
BAD   it("handles edge case 3")                <- the reader must open the file
BAD   it("calls sessions.create with the right args")  <- describes the test
```

Where a money figure is the point, put the arithmetic in the title. `"prices 7
days on the weekly tier as 75.00 x 7 = 525.00"` is checkable on paper by someone
who never opens the file, which is the whole objective.

**2. A test that pins a KNOWN DEFECT is named for what the code actually does**,
in the present tense, with no hedging — so the catalogue reads as an honest
inventory:

```
it("silently bills a reversed date range as a single day instead of rejecting it")
it("falls through to the DAILY rate at 30 days, making one extra day cost 495.00 more")
```

**3. A watchdog is named for what SHOULD be true**, and starts with "should" —
the only place that word belongs:

```
it.fails("should fall back to the weekly rate, not the daily rate, at 30 days")
it.fails("should never return a non-finite price, whatever monthly_tier_days holds")
```

`describe()` names the **subject** under test, never the file:
`describe("rental pricing — the day count")`, not `describe("01-pricing-maths")`.

Add `@usecase <one line>` to the comment immediately above a `describe` and the
generator lifts it into the catalogue as that block's stated purpose.

## 11. Known-defect watchdogs — `it.fails`

When a test would have to assert something wrong to go green, **do not assert the
wrong thing.** A test encoding a bug turns red the day someone fixes the bug, and
whoever fixed it then "repairs" the test back to the broken expectation. That has
happened on this repo and had to be undone.

Write a pair instead:

```ts
it("falls through to the DAILY rate at 30 days, making one extra day cost 495.00 more", () => {
  expect(priceFor(30, NO_MONTHLY).rentalPrice).toBe(2670.0); // 89.00 x 30 — the actual
});

it.fails("should fall back to the weekly rate, not the daily rate, at 30 days", () => {
  // Remove the `.fails` marker once calculate-rental-price.ts:479-489 is fixed.
  expect(priceFor(30, NO_MONTHLY).rentalPrice).toBe(2250.0); // 75.00 x 30 — correct
});
```

The first records the size of the error. The second states the truth and, because
`it.fails` inverts the result, is **green while the bug lives and red the moment
it is fixed** — which forces the pair to be revisited rather than silently
enshrining the defect.

**A watchdog going red is good news.** It means someone fixed the bug. Delete the
pinning test, remove the `.fails` marker, and keep the correct expectation.

Every watchdog carries a `// Remove the .fails marker once … is fixed` comment
naming the file and lines to change. The catalogue lists them all under
**⚠ watchdog**.

## 12. The generated catalogue

```bash
npm run test:docs
```

Runs the suite, harvests its own `--reporter=json` output, and rewrites
[TEST-CATALOGUE.md](./TEST-CATALOGUE.md) plus `test-catalogue.json`. Both are
generated — editing them by hand is discarded on the next run.

The generator adds three things the raw report does not carry:

- **Layer**, inferred from evidence in each file rather than a convention someone
  has to remember: importing `live-call` means it has Layer 2 tests; reading
  source text means Layer 1; importing a real module through `@fn` or an app path
  and calling it means Layer 3. A file can be several. Unclassifiable is reported
  as `unclassified`, never guessed.
- **Watchdogs.** `it.fails` tests report as `passed` in the JSON when their inner
  assertion fails — which is the watchdog working — so they are indistinguishable
  in the report. They are recovered by parsing each source file for `it.fails(`
  and matching titles.
- **Use cases**, from `@usecase` lines. Absent means absent; nothing is invented.

Run it after adding tests, and paste the summary line into the PR.
