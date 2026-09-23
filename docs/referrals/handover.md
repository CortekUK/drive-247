# Platform promo codes and operator referrals: handover for review

Branch `referral-programme`, 2026-09-22. For review (D13).

**Part of this is already live on production**, at the owner's instruction
(2026-09-22):

- The two additive migrations are applied (13 tables, 2 nullable columns, the
  settings row and the default tiers), recorded in the migration history.
- All seven functions are deployed.
- The **cron migration is NOT applied**, so the engine only runs when someone
  runs it from the admin screen.
- The portal, admin and marketing apps are **not** deployed, so nothing changed
  for operators or visitors yet. The screens were driven from localhost against
  production data.

It was then exercised on production in Stripe **test** mode, with test-mode
tenants only: the Test tenant referred Link Test Co 2 by hand. The referee's
subscription took a 20% coupon ending exactly three months out, the referrer's
own subscription took the 10% reward coupon ($200 → $180), and the referrer got
the portal notice and the email. Voiding is still to be exercised.

Everything else below was verified locally against a real Postgres and a Stripe
emulator (see [Verification](#verification)).

## What was built

| Decision | Implementation | Where |
|---|---|---|
| D1 promo codes are the core; a referral code is a promo code owned by an operator | `platform_promo_codes` (kind `campaign` / `referral`), with versions: editing terms supersedes the old row and reuses the same string | migration `20260922120000`, `_shared/platform-promo.ts` |
| D2 the referral link applies the code | `drive-247.com/r/{CODE}` sets the `d247_ref` cookie (90 days) and lands on pricing with an invite banner; a `?ref=` landing also sets it | `apps/web/src/app/r/[code]`, `referral-banner.tsx`, `remember-referral-code.tsx` |
| D3 super admin Promo Codes tab | Codes, Operators, Referrals, Claims, Settings, Leaderboard tabs | `apps/admin/app/admin/(protected)/promo-codes`, `components/admin/promo-codes/*` |
| D4 sales can send links | Sales agents can list, copy, and put a code on a pending payment link; nothing that changes money terms, tiers or attributions | `admin-promo-codes` (`SALES_ACTIONS`), `link-promo-picker.tsx` on the operator page |
| D5, D6 tiered referrer reward, per-operator table with a platform default | `referral_tiers` (default 1→10%, 3→20%, 5→30%); levels, never summed; an operator's own table replaces the default | `platform-promo-rules.ts` (`resolveTier`), admin Operators tab |
| D7 per-operator referee discount, default 20% for 3 months | The operator's code carries the terms; codes on the default follow a change to the default on the next engine run | `referral-engine` step 1 |
| D8 the referrer's reward applies from their next bill | The payment-link success path records the referral and runs the engine for the referrer at once; the 15-minute engine run is the backstop | `subscription-link-v2` (done), `referral-engine` |
| D9 the referee sees the discount at checkout and in the portal | Discounted price on the pricing cards, the payment link page and the signup card step (Stripe's own first-invoice amount); "joined with a code" on the portal page | web pricing / subscribe / onboarding, `tenant-referrals` |
| D10 `{BRAND}-{DIGITS}` | Brand from the company name without generic words (RENTALS, CAR, LLC…), max 10 characters, 4 digits by default (3/4/6 setting) | `brandPrefixFrom`, `referralCodeCandidate` |
| D11 one code per checkout | A typed code cannot sit on top of one sales pre-applied; self-serve takes one code | `promo-code-lookup`, `subscription-link-v2` |
| D12 manual attach | Admin attaches a referral, optionally putting the referrer's code discount on the referee's existing subscription; void with a reason | `admin-promo-codes` `attach_referral`, `void_referral` |

The operator's page is `/referrals` in the portal, shown in both the v1 and v2
menus for tenants in `V2_AREAS.referrals` (Northwind and the Test tenant today)
and for tenants on the full v2 experience. Opening it to everyone means adding slugs there
(`apps/portal/src/lib/v2.ts`). The programme itself runs for all tenants once
deployed: every subscribed operator gets a code.

## Defaults built for the recommendations (please confirm)

| # | Built as |
|---|---|
| R1 | A referral counts only while the referee's subscription is `active`, `trialing` or `past_due`. |
| R2 | Discounts apply to the plan only (`applies_to` = the plan's product): never the $1 card check or metered e-sign usage. |
| R3 | Sales agents: read, copy, and pick a code on a payment link only. |
| R4 | 4 digits, with a 3/4/6 setting. |
| R5 | A visitor carrying a usable code sees pricing even while the landing-page pricing switch is off. |
| R6 | "Someone joined because of me" claim form on the portal page; approved or rejected in admin. |
| R7 | The referrer is told in the portal and by email when their reward goes down or pauses, not only when it goes up. |
| R8 | Codes are for new subscriptions only (an operator who ever held a real subscription is not new). |

## Deviations from the brief, and why

- **Coupons, not Stripe promotion codes.** Sales onboarding creates a product
  per plan, so one Stripe promotion code cannot cover every plan. A code's
  coupon is minted per (account, mode, product, trial variant) and attached
  directly; `platform_promo_code_stripe` mirrors them. On a payment link with a
  free trial, "3 months" is stretched over the trial so it means 3 real bills.
- **Copies instead of edits (V2_PLAN §7).** `subscription-link-v2`,
  `signup-payment-intent-v2` and `apply-subscription-discount-v2` are copies of
  the originals with the promo code added. The web app calls the v2 link and
  signup functions only when a code is involved.
- **The admin discount tool now uses `apply-subscription-discount-v2`.** The
  original attaches with Stripe's `coupon` parameter, which replaces every
  discount, so it would silently wipe a referral reward. The v2 tool edits the
  `discounts` list and keeps the tier reward last. **Deploy it before the admin app.**
- **The brief arrived truncated at §9.3.** §9.4–§18 (including the code-format
  section) were not available; everything here follows D1–D13 and R1–R8.
- **Stripe `discounts` on API version 2023-10-16.** The pinned SDK (stripe@14.21.0)
  has no types for it, but the parameter exists on that API version: stripe-node
  14.24.0, the same version line, added `discounts` to subscription create and
  update. Checked against 14.25.0's types.

## Bugs found by running it, now fixed

| Bug | Effect if shipped | Fix |
|---|---|---|
| Removing the only discount sent `discounts: []` | stripe-node drops empty arrays, so Stripe got an empty update: a referrer's reward would never come off | Send `discounts: ""` (proved with the real SDK) |
| Tier updates used an idempotency key per (subscription, target, UTC hour) | A reward going 10% → none → 10% within an hour (for example void then re-attach) replayed the first response and applied nothing | No key: the update replaces the whole list from a fresh read, so repeating it is safe |
| `expand: ["items.data.price"]` | Not an expandable path; Stripe rejects the request, which would break the tier update and manual attach | Removed (items carry their price already) |
| Tier notices deduplicated per minute | "Reward paused" then "reward back" in one minute: the second notice and email dropped | Dedupe key includes the new standing |
| Payment-link success page started the engine without waiting | The runtime can end the worker when the response is sent, dropping the referrer's instant reward | `EdgeRuntime.waitUntil`, as `signup-password-reset` does |
| The code column list was a string concatenation | supabase-js typed every row as an error (type-check only) | One string literal |

## Verification

| Check | Result |
|---|---|
| Migrations in a real Postgres (PGlite) on stand-ins for their dependencies | 57/57: constraints, rotation, tier and referral uniqueness, void rules, cron copy, RLS (operators see only their own rows, anon nothing, no RLS change on existing tables). The cron migration now fails loudly if the job it copies is missing. |
| Every query on new and existing tables vs the schema | 144 queries in this branch's files, no unknown column (existing tables per the admin app's generated types) |
| Edge functions, typed against real Stripe types (stripe@14.25.0, API 2023-10-16) | Clean, apart from an existing error in `_shared/resend-service.ts` that is not this feature's |
| End to end: the real functions, real SQL, strict Stripe emulator | 23 scenarios, 130 checks, all passing (below) |
| Portal unit tests (referral rules, experience gate, search) | 238 passing |
| `tsc` for web and admin | Clean |

The end-to-end test covers: codes for every eligible operator; the portal page
and cross-tenant refusal; public lookup; sales putting a code on a payment link;
the link page's discounted price and the one-code rule; Checkout with the
plan-only coupon; payment → redemption → referral → tier reward, portal notice
and email; idempotent engine runs; the admin one-time discount alongside the
reward; referee cancels → reward really removed; manual attach with the referee
discount; void; claim → approve; rotating a code and changing the default;
self-serve signup with a code, dropping it and adding it back; discovery after
provisioning; savings from a paid invoice; campaign plan limits, payment-link
refusal and max uses; custom tiers, reset and brand; leaderboard and sales
read-only; switching the programme off; the engine lease; the lookup throttle.

Run it from the repo root (needs Deno; downloads modules on first run):

```
deno test -A --no-check --config supabase/functions/_tests/referrals/deno.json supabase/functions/_tests/referrals/
```

**Not verified:** real Stripe test mode (no key was used), a real Supabase
project, and clicking through the UIs in a browser. The emulator follows
Stripe's documented behaviour but is not Stripe.

## Deploy order, once approved

1. ~~Apply `20260922120000_platform_promo_codes.sql` and
   `20260922120100_promo_code_on_links_and_leads.sql`~~ — **done 2026-09-22**.
   Never `supabase db push` here: 135 local migrations are missing from the
   remote history (they were applied by hand), so a push would run all of them.
2. ~~Deploy the seven functions~~ — **done 2026-09-22**
   (`supabase functions deploy … --use-api`, which needs no Docker).
   `config.toml` sets `verify_jwt = false` for the two public ones.
3. Apply `20260922120200_schedule_referral_engine.sql` (the 15-minute cron).
   On production only; it copies the existing reconciler job's URL and auth.
4. Deploy admin (it now calls `apply-subscription-discount-v2`), then portal,
   then web.
5. Canary: Northwind. Test in Stripe test mode first: a payment link with a
   code, a self-serve signup with a code, and a tier going up and down.

On the first engine run every subscribed operator gets a code, and each live
subscription is scanned once (one Stripe read each).
