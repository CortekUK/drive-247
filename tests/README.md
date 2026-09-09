# `tests/` — the spine suite

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
(Haseeb proposed it, Ghulam: *"bilkul exactly, waise hi karenge hum"*), but it
is scaffolded rather than filled — see §7.

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

`scripts/db-switch.mjs` already knows a non-production branch clone
(`ksmreaadhbirzakkxqrq`). That is the intended target.

Nobody has run Layer 2 against it yet — there are no keys for that project in
this repo — so there is no "expected" live tally to quote here, and inventing one
would be worse than leaving the gap. What has been run and verified is the
default: **26 passed, 7 skipped, 8 todo, no network.**

---

## 7. Scope

> "yeh automatic test sirf abhi sirf yeh **ONBOARDING FLOW** tak hi honge."

Onboarding only. `integrations/stripe/` is scaffolded because the folder shape
was agreed, not because the payments surface is being built out now — see
`integrations/stripe/README.md`. Its behavioural cases are `test.todo`, which
prints them in the run output as named, unwritten cases so the list stays visible
instead of living in someone's head.

## 8. Layout

```
tests/
  README.md                     this file
  vitest.config.ts              node env, single fork, no isolation, 01..05 order
  helpers/
    edge-contract.ts            parse an edge function's read fields from source
    live-call.ts                the gated caller + the production refusal
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
      checkout.test.ts
      refund.test.ts
      partial-payment.test.ts
```

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
