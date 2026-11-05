# Drive247 QA Guide

The single source of truth for how Drive247 is tested **before** release and watched
**after** release.

> **If you are an AI session:** read this whole file before doing any QA work, then
> `QA/MASTER_PLAN.md` (what to test, order, parallel-session rules), then
> `V2_PLAN.md` §0, §2–§5. Follow it exactly. When Ghulam agrees a new rule or changes
> one, **update this file in the same turn** and add a line to the Change log (§16).
> If something here contradicts what Ghulam says now, Ghulam wins — then fix this file.

---

## Contents

1. Why this exists
2. Non-negotiables
3. Roles
4. Vocabulary
5. The QA loop (the process)
6. Modules before flows
7. The checklist standard
8. Golden tables + Vitest (the math)
9. Tenant isolation (data mixing)
10. One rule, one place (no duplicate logic)
11. Re-test packs and the parent command (`npm run qa`)
12. Test environment and data
13. After release: monitoring and alerts
14. Scoreboard
15. Worked example
16. Change log

---

## 1. Why this exists

Drive247 is a live multi-tenant car-rental platform. ~32 paying operators run their
business on production right now, and there is **no staging** (`V2_PLAN.md` §0).

Ghulam's three biggest fears, which every rule below serves:

| Fear | Covered by |
|---|---|
| One operator's data shows up for another | §9 Tenant isolation |
| Wrong math — price, rental days, order totals, refunds | §8 Golden tables + Vitest |
| Something that worked quietly breaks later | §11 Re-test packs, §13 Monitoring |

The bar: a signed-off module or flow **does not break on edge cases**, and if anything
does break in production, Ghulam's phone knows before an operator does.

---

## 2. Non-negotiables

0. **END TO END ACROSS EVERY APP — the most important rule.** Every module and flow is
   tested across all five surfaces: landing page (LP), super admin (SA), operator portal
   (OP), booking site (BS) and customer portal (CP), plus backend (BE) and outgoing
   messages (MSG). Every checklist states, for each surface, what must be true there,
   or "not touched — checked". Nothing is left out. See `MASTER_PLAN.md` §1.
1. **Strict standard, no compromise.** Every checklist meets §7 in full. No "light" version.
2. **One step at a time.** Never move to the next step until the current one is ✅.
3. **Modules before flows** (§6).
4. **No duplicate logic** (§10). One rule, one place.
5. **Every query filters by `tenant_id`.** A missing filter is a P0, always (`V2_PLAN.md` §5).
6. **v2 only, gated to `northwind`.** Never edit a v1 file in place; never change a v1 edge
   function's behaviour (`V2_PLAN.md` §3, §7). Fixes found by QA follow the same rule
   unless Ghulam says it is a real v1 production bug.
7. **Database changes are additive only** (`V2_PLAN.md` §4).
8. **Never charge real money while testing.** Payments only with Stripe **test** cards,
   through the rehearsal email (§12).
9. **`npm run qa` is run by Ghulam, by hand.** Never wire it to a git hook or run it
   automatically on push (§11).
10. **Never commit or push unless Ghulam says so.**
11. **Answers in golden tables come from business rules, never from the code being tested** (§8).

---

## 3. Roles

| | Ghulam (G) | AI (C) |
|---|---|---|
| Decides the flow and its start/end | ✅ | proposes |
| Lists the modules a flow uses | confirms | ✅ |
| Writes checklists and golden-table questions | reviews | ✅ |
| Confirms golden-table **answers** | ✅ | drafts |
| Code, edge-function, DB and log checks | | ✅ |
| Fixes bugs | | ✅ |
| All UI and manual testing, mobile + desktop | ✅ | |
| Verifies each manual step behind the scenes | | ✅ |
| Writes and maintains automated tests (Vitest, scripts) | | ✅ |
| Runs `npm run qa` before a push | ✅ | can run on request |
| Signs off a module or flow | ✅ | |
| Keeps the scoreboard and this guide current | | ✅ |

Rule of thumb: **anything you can see on a screen is Ghulam's; anything behind it is the AI's.**

---

## 4. Vocabulary

| Term | Meaning |
|---|---|
| **Module** | A self-contained capability, usually a third party or a common building block: Stripe, BoldSign agreements, Bonzah insurance, uploads, email/SMS, push |
| **Flow** | A user journey from a start to an end that uses one or more modules, e.g. Onboarding, Create rental |
| **Step** | One screen or action inside a flow |
| **Checklist** | The strict test document for a module or flow (§7) |
| **Golden table** | An answer key: situations + correct results decided by a human (§8) |
| **Re-test pack** | What a signed-off module/flow leaves behind: automated checks, a short manual pass, a flow map (§11) |
| **Flow map** | The files, edge functions and tables a module/flow touches |
| **Health check** | A quick "is this module alive and correct" probe, reused as a production monitor (§13) |
| **Self-pass** | The AI's own run through a checklist before Ghulam tests anything |
| **G / C** | Who does a checklist row: Ghulam / Claude (AI) |
| **P0–P3** | Severity (§7.3) |

---

## 5. The QA loop

```
 1. Ghulam names a FLOW                      "Create rental"
 2. Agree start → end                        "from Add rental to agreement signed"
 3. AI lists the MODULES it uses             Stripe, BoldSign, Bonzah, Uploads
 4. For each module NOT yet signed off  ──▶  run steps 5–11 for the module first
 5. AI writes the checklist (§7)  +  golden table if there is math (§8)
 6. AI SELF-PASS: runs every C check it can (code, DB, edge fns, logs, Vitest)
    and FIXES every inconsistency straight away
 7. AI says: "Ready for manual testing."
 8. Ghulam tests ONE step (UI, mobile + desktop), reports:
       "step 2 done, all good — used qa1@…, slug qa-test-1"
    (screenshot on anything odd)
 9. AI verifies that step behind the scenes (DB, edge fns, logs)
       ✅ → "Step 2 clean. Step 3: …"
       ❌ → fix → Ghulam re-tests that row → regression set (§11.3) → ✅
10. Repeat 8–9 until every row is ✅
11. Exit criteria met (§7.5) → Ghulam signs off → re-test pack saved (§11)
12. Back to the flow (step 5) once all its modules are signed off
```

Rules of the loop:

- The AI hands out **one step at a time**, never the whole checklist at once.
- Ghulam does not run ahead.
- Anything that "feels off" is reported, even if unsure.
- The AI keeps the scoreboard; Ghulam never tracks state by hand.

---

## 6. Modules before flows

A flow is only as solid as the modules under it. When a flow is decided, the AI says
which modules it passes through, and any module not yet signed off goes through the
**same loop (§5) first**.

```
                 FLOWS  (tested second)
   ┌──────────────┬──────────────┬──────────────┐
   │  Onboarding  │ Create rental│  Extension   │
   └──────┬───────┴──────┬───────┴──────┬───────┘
          ▼              ▼              ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Stripe  │ │ BoldSign│ │ Bonzah  │ │ Uploads │ │ Email / │
   │         │ │         │ │         │ │         │ │ SMS     │
   └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
                 MODULES  (tested first, on their own)
```

A **module checklist** has everything in §7, plus:

| Extra | What |
|---|---|
| **Contract** | What goes in, what comes out, every error it can return |
| **Failure tests** | Third party down, slow, returns an error, sends the same webhook twice, sends events out of order. The module must show a clear message, retry safely, and never double-charge / double-send |
| **Health check** | A probe the AI can run any time (reachable? last webhook succeeded? failures in 24h?). It becomes a production monitor (§13) |
| **Its one place in code** | The single client/helper every caller goes through (§10), e.g. `supabase/functions/_shared/boldsign-client.ts` |
| **Test mode** | How to run it with no real effect (Stripe test, BoldSign test, Bonzah sandbox) |

**A module is tested in full once.** Later flows only run its health check and its
automated tests, unless the module's own code changed.

Suggested order (money and trust first): Stripe → BoldSign → Bonzah → Uploads → Email/SMS → Push.

---

## 7. The checklist standard

Files: `QA/modules/<module>.md` and `QA/flows/<flow>.md`.
Reference example: `QA/flows/onboarding.md`.

### 7.1 Required sections, in order

1. **Scope** — in / out, and the flow map (step → screen → edge function).
2. **Test plan**
   - environment (it is production — say what that means for this flow)
   - safe test data and hard rules (what must never be touched or charged)
   - original values to restore after testing
   - device matrix
   - the real limits from the code (lengths, expiries, retry counts, rate limits)
3. **Severity scale** (§7.3) and case types (§7.2).
4. **Checklist** — one table per step.
5. **How we run it** (the loop, §5).
6. **Bug log** (§7.4).
7. **Exit criteria** (§7.5).

Row format:

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| ON-4.12 | Interrupt | Double-click Pay | One charge | G | P0 | ✅ / ❌ BUG-3 / ⏭ reason |

IDs are `<FLOW>-<step>.<n>`, e.g. `ON-2.5`, `RENT-3.1`, `BOLD-1.4`.

### 7.2 Case types — every step needs a mix

| Type | Meaning |
|---|---|
| **Happy** | Normal use works |
| **Boundary** | Shortest / longest / strangest valid and invalid values: max lengths, 0, negatives, emoji, Arabic, apostrophes, spaces, capitals |
| **Negative** | Wrong input, wrong state, wrong permissions → clear message, nothing broken |
| **Interrupt** | Double-click, back button, refresh, close tab, two tabs, network drop, slow network |
| **Security** | Skip a step by calling the server directly, act on another tenant's data, abuse limits |
| **Message** | Every email, SMS and on-screen text: correct, no typos, readable on phone |
| **Device** | D1 desktop Chrome, D2 desktop Safari, D3 iPhone Safari. Every P0 row runs on all three |
| **Isolation** | Data from another tenant never appears (§9) |
| **Math** | Covered by the golden table (§8) |

### 7.3 Severity

| Level | Meaning | Ships? |
|---|---|---|
| **P0** | Money taken with nothing delivered, duplicate charge, wrong amount, user stuck with no way out, data from another tenant visible | Never |
| **P1** | Broken, but the user can recover (retry works, clear error) | Never |
| **P2** | Wrong copy, layout off, slow but works | Only with Ghulam's written OK |
| **P3** | Cosmetic | Yes, logged |

### 7.4 Bug log format

| Bug | Row | Pri | Steps to reproduce | Expected | Actual | Evidence | Fix | Re-tested |
|---|---|---|---|---|---|---|---|---|
| BUG-1 | ON-4.15 | P0 | 1. … 2. … | charges $199 | 500 error | log id / screenshot | commit / file | ✅ G 2026-10-12 |

### 7.5 Exit criteria — all must be true

- [ ] Every P0 and P1 row ✅
- [ ] Every P0 row passed on D1, D2 and D3
- [ ] Two complete clean runs from scratch, back to back
- [ ] Golden table 100% green in Vitest (if the module/flow has math)
- [ ] Isolation checks all zero (§9)
- [ ] Zero open P0/P1 bugs; every P2 fixed or accepted by Ghulam in writing
- [ ] Every fix followed by its regression set (§11.3)
- [ ] Zero leftover test data after cleanup
- [ ] Original values restored
- [ ] `npm run v1:check` passes
- [ ] Re-test pack written and added to `npm run qa` (§11)

### 7.6 Autofill wand rule

Long forms must not be typed by hand on every run. On `northwind`, v2 forms get a
**wand** button that fills every field with random valid data.

- Already exists: v2 Add customer and Add vehicle (`apps/portal/src/lib/dev-autofill.ts`).
- Switched on in **Super admin → Developer → Previews → "Autofill buttons"**.
- Gated by slug to `northwind` only.
- **When a flow under QA has a long form without a wand, the AI adds one** as part of
  writing the checklist.

---

## 8. Golden tables + Vitest (the math)

### 8.1 What a golden table is

An **answer key**. A list of real situations with the correct result worked out by a
human who knows the business rules — not copied from the code under test.

| # | Situation | Correct result |
|---|---|---|
| 1 | 3 days, daily $50 | $150 |
| 2 | 7 days, daily $50, weekly $300 | $300 |
| 3 | Fri 10:00 → Mon 10:00, 20% weekend surcharge on Sat+Sun | Ghulam decides |
| 4 | Pickup 10:00, return 11:00 next day — 1 day or 2? | Ghulam decides |

### 8.2 Which modules/flows need one

Anything that computes money, time or quantity: rental price, rental days/hours, weekly
and monthly tiers, weekend and holiday surcharges, vehicle overrides, extras, promo and
referral codes, deposits and holds, tax, extensions, refunds, installments, invoice
totals, mileage, late fees.

Situations must cover: tier boundaries (6d23h / 7d / 7d1h), month ends, leap day,
daylight-saving change, time zones, minimum rental hours, zero and maximum values,
rounding (always integer cents), and combinations (surcharge + promo + extra + tax).

Aim for 40–60 rows per calculator.

### 8.3 Who does what

| Task | Who |
|---|---|
| Find the math, write the situations | AI |
| **Decide the correct answers** | **Ghulam** |
| Write Vitest tests from the table | AI |
| Run, fix anything red | AI |

### 8.4 Vitest

Vitest is the test runner (already configured in `apps/portal` and `apps/booking`). It
asks the code every golden-table question and marks ✅ / ❌.

```
Golden table · rental price
  ✅ #1  3 days daily              $150
  ✅ #2  7 days → weekly price     $300
  ❌ #3  weekend surcharge         expected $180, got $170   ← bug
```

Vitest also runs:

| Suite | Checks |
|---|---|
| Golden tables | Math is correct |
| Copy agreement | Every copy of a calculator gives the same answer (until merged, §10) |
| Module failure tests | Third party down / slow / duplicate webhook, simulated with mocks |
| Isolation scan | No query on a tenant table forgets `tenant_id` (§9) |

**Rule:** anything with math cannot be signed off until its golden table is 100% green.

### 8.5 Known state (2026-10-11)

`calculate-rental-price.ts` exists in **4 copies**:

| Copy | Same as portal? |
|---|---|
| `apps/portal/src/lib/calculate-rental-price.ts` | — |
| `apps/booking/src/lib/calculate-rental-price.ts` | identical |
| `supabase/functions/_shared/calculate-rental-price.ts` (server) | **differs** |
| `apps/booking/src/northwind-site/lib/domain/calculate-rental-price.ts` | **differs** |

There are **zero** tests on any of them. A customer can be shown one price and charged
another without anything noticing. This is the first golden table to build.

---

## 9. Tenant isolation (data mixing)

### 9.1 Why it is a risk

Row-level security is **off** on the core tables (rentals, customers, vehicles, payments,
invoices, ledger_entries, app_users). The only thing separating operators is that every
query says "only this tenant". The owner has chosen to keep it that way for now; **do not
switch RLS on opportunistically** (`V2_PLAN.md` §5).

### 9.2 Four layers

| Layer | What | When |
|---|---|---|
| **1. Code scan** | Script reads every DB query and flags any on a tenant table without a `tenant_id` filter | In `npm run qa` (before push) |
| **2. Data checks** | SQL that must always return 0 (below) | In every re-test pack, in `npm run qa`, and scheduled in production (§13) |
| **3. Leak test** | A second test tenant with obvious data (customer "ZZ LEAK TEST", vehicle "LEAK-001"). While testing northwind, Ghulam searches for it. Seeing it anywhere is a P0 | Every manual pass |
| **4. Database lock** | Switch RLS on, table by table | A separate, planned project — not part of QA |

### 9.3 Data checks (all must be 0)

| Check | Result 2026-10-11 |
|---|---|
| Rental's customer belongs to another tenant | 0 |
| Rental's vehicle belongs to another tenant | 0 |
| Payment's rental belongs to another tenant | 0 |
| Payment's customer belongs to another tenant | 0 |
| Invoice's rental belongs to another tenant | 0 |
| Rentals / vehicles / payments with no tenant | 0 |
| **Customers with no tenant** | **5 — to investigate** |

New checks are added whenever a new table relationship is tested.

---

## 10. One rule, one place (no duplicate logic)

Every piece of business logic lives in **exactly one place**, and every app, screen and
edge function calls that place.

| Kind of duplication | Example | Allowed? |
|---|---|---|
| Accidental | Same price math in 4 files | ❌ Never — fold into one |
| Temporary, on purpose | v1 screen + v2 screen during the switch-over | ✅ Only with a planned deletion (`V2_PLAN.md` §3) |
| Looks only | A button styled differently per app | ✅ Screens may differ; rules and math may not |

Where the one place lives:
- pure shared logic → root `shared/` folder (the portal already imports `shared/trax-support`)
- server logic → one edge function / one `_shared` helper
- third parties → one client file each (`_shared/stripe-client.ts`, `boldsign-client.ts`, `bonzah-client.ts`, …)

Rules for the AI:
1. Before building anything, search for an existing implementation and reuse it.
2. Never copy logic into a second file or app.
3. Every checklist has a **duplicates** check; any duplicate found is reported with a plan to merge.
4. Merge order: money first (pricing, extensions, totals), then agreements, then the rest.

---

## 11. Re-test packs and the parent command

### 11.1 Re-test pack — what every signed-off module/flow leaves behind

| Piece | What | Who runs it |
|---|---|---|
| **A. Automated checks** | Vitest suites (golden tables, failure tests) + DB checks for that module/flow | `npm run qa` |
| **B. Short manual pass** | Only its P0 rows, ~5–10 minutes, with the wand filling forms | Ghulam |
| **C. Flow map** | Files, edge functions, tables, third parties it touches | AI uses it for §11.3 |

### 11.2 The parent command

```
npm run qa
  │
  ├─ 1. SAFETY     isolation code scan + cross-tenant data checks
  ├─ 2. MODULES    every signed-off module, one by one
  ├─ 3. FLOWS      every signed-off flow's essential checks
  └─ 4. SUMMARY    ✅ safe to push   /   ❌ what broke, where
```

```
npm run qa                 everything
npm run qa -- boldsign     one module
npm run qa -- onboarding   one flow
```

Rules:
- **Run by Ghulam, by hand, before a push. Never on a git hook, never automatic.**
- Modules run before flows so a failure points at the right layer.
- Output is narrated and readable ("Running BoldSign… 9/9 passed").
- It grows: each sign-off adds its pack. It is built once the first module/flow is
  signed off, so it never starts as an empty shell.
- A red result means **do not push**.

### 11.3 When something changes

```
A change is made (any reason)
   │
   ▼
AI checks every flow map → which signed-off modules/flows touch the changed files?
   │
   ▼
AI runs their automated checks → Ghulam runs their short manual passes
   │
   ▼
All green → continue      Anything red → fix first
```

Within one checklist, after any fix: re-run the fixed row **and every other P0 row in
that step** (the regression set).

---

## 12. Test environment and data

- **Production only.** There is no staging. Test on the canary tenant **`northwind`**
  (prod id `6e5c544f-b374-451f-a662-360a634bff15`, `portal_experience = 'v2'`).
- **Synthetic data only** on northwind. Never copy real customer data.
- **Third parties in test mode** on northwind: Stripe test, BoldSign test, Bonzah sandbox.
- **Rehearsal email** (Super admin → Developer, table `dev_signup_rehearsal`): the only
  address that pays with Stripe test cards in signup. Can link the signup to northwind
  or build a fresh tenant. Reset between runs from the Developer page.
- **Every other email is charged on LIVE Stripe** in signup. Never press Pay with one.
- Anything that changes what real visitors see (e.g. signup plans on the landing page)
  is restored in the same sitting; prices on live plans are never changed without
  Ghulam's go-ahead.
- Stripe test cards:

| Card | Behaviour |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0000 0000 0002` | declined |
| `4000 0025 0000 3155` | 3D Secure required |
| `4000 0000 0000 9995` | insufficient funds |

- Test data naming: `qa+<flow><n>@…`, slugs `qa-<flow>-<n>`, names prefixed `QA`.
- After each session the AI deletes the test data (DB rows, Stripe test objects, storage
  files) and confirms zero leftovers.

---

## 13. After release: monitoring and alerts

Testing proves it works before release. Monitoring proves it **keeps** working.

### 13.1 What is monitored

| # | Area | Question | Drive247 examples |
|---|---|---|---|
| 1 | **Errors** | Is the app crashing for anyone? | **Sentry** in portal, booking, admin, web, edge functions (to be installed) |
| 2 | **Uptime** | Is each site up? | A probe opens the portal, booking site, landing page and admin every minute |
| 3 | **Third parties** | Are partners working? | Stripe webhooks arriving, BoldSign webhooks succeeding, Bonzah balance and API, email/SMS delivery and bounces |
| 4 | **Business health** | Is the data still correct? | Scheduled §9.3 checks (= 0), no payment without a rental, no rental stuck mid-creation, no agreement unsent after 24h, invoices = sum of lines |
| 5 | **Speed** | Is it getting slow? | Booking and portal page times, slow edge functions |

**Area 4 is the most important for a rental business.** A wrong price or an orphaned
payment crashes nothing — only a scheduled check finds it.

### 13.2 Where it lives

- **Monitoring dashboard in Super admin**: one page, every monitor, green / amber / red,
  last checked, last failure, link to its playbook.
- **Alerts go to Ghulam's phone as push notifications.** Admin already has Web Push
  (`apps/admin/lib/push.ts`, edge function `send-push`, log in `push_notification_log`).
- Every module/flow signed off in QA turns its **health check** and **data checks** into
  monitors. Nothing extra to invent later.

### 13.3 Alert levels

| Level | Example | Delivery | Speed |
|---|---|---|---|
| **P0 critical** | Payments failing, a site down, cross-tenant data found, money taken with no rental | Push to phone, repeated until acknowledged | Immediately, 24/7 |
| **P1 serious** | BoldSign webhooks failing, emails not sending, Bonzah API down | Push to phone | Within minutes |
| **P2 warning** | Bonzah balance low, pages slowing | Dashboard + daily digest | Same day |
| **P3 info** | Weekly errors, uptime %, failed webhooks | Weekly digest | No rush |

### 13.4 Rules

1. **No noise.** Every alert must mean "someone needs to act". A noisy alert is fixed or removed.
2. **Every alert has a playbook**: what it means, what to check, what to do.
3. **No duplicate alerts** for one incident; group them.
4. **After every real incident**: were we alerted fast enough? If not, add or tighten a monitor.
5. **Monitors must not change data.** Read-only, always filtered by tenant where relevant.

### 13.5 Build order

1. Sentry (errors)
2. Uptime probes on the four sites
3. Scheduled business-health checks, starting with §9.3 and stuck payments
4. Third-party health per module, as each is signed off
5. Super admin monitoring dashboard + push alerts wired to all of the above

---

## 14. Scoreboard

The AI updates this after every session.

### Modules

| Module | Checklist | Status | Signed off |
|---|---|---|---|
| Stripe signup payments | (inside `flows/onboarding.md`) | Checklist written | — |
| Stripe Connect / booking payments | — | Not started | — |
| BoldSign agreements | — | Not started | — |
| Bonzah insurance | — | Not started | — |
| Uploads | — | Not started | — |
| Email / SMS | — | Not started | — |
| Push notifications | — | Not started | — |

### Flows

| Flow | Checklist | Modules used | Status | Signed off |
|---|---|---|---|---|
| Onboarding (plan → portal) | `flows/onboarding.md` | Stripe signup payments, Email | Checklist written; AI self-pass not run | — |

### Open findings

| Found | Finding | Severity | Status |
|---|---|---|---|
| 2026-10-11 | Growth plan (highlighted on pricing) has no stored `stripe_price_id`; Starter and Scale do | P0 until proven | To test (ON-4.15) |
| 2026-10-11 | 4 copies of the rental price calculator, 2 differ, 0 tests | P0 | Golden table needed |
| 2026-10-11 | 5 customers with no `tenant_id` | P1 | To investigate |
| 2026-10-11 | System announcement titled "Maintanance Testing" (typo), active on northwind | P3 | Open |

---

## 15. Worked example — "Create rental"

1. **Ghulam:** "Let's QA creating a rental, from Add rental to agreement signed."
2. **AI:** "That flow uses Stripe (deposit/payment), Bonzah (insurance), BoldSign
   (agreement) and Uploads (licence photo). None is signed off, so we start with Stripe."
3. **Stripe module**, through the full loop:
   - AI writes `modules/stripe.md`: contract, failure tests (declined, 3DS, webhook twice,
     webhook late), health check, test mode.
   - Golden table for deposits, holds and refunds → Ghulam confirms the answers → Vitest green.
   - AI self-pass finds a refund rounding to the wrong cent → fixes it.
   - "Ready for manual testing." Ghulam tests step by step; AI verifies each.
   - Signed off → `npm run qa -- stripe` exists; its health check becomes a monitor.
4. **Bonzah, BoldSign, Uploads** — the same, one at a time.
5. **The flow**: AI writes `flows/create-rental.md` with a golden table for the rental
   total (days, weekly tier, weekend surcharge, extras, insurance). Self-pass, fixes,
   manual run, verification, sign-off.
6. **Later**, while testing Extensions, the AI changes `form-grid-v2.tsx`. Flow maps show
   Add vehicle and Add customer use it → their automated checks run → one fails → fixed →
   Ghulam runs their 5-minute manual passes → back to Extensions.
7. **Before the push**, Ghulam runs `npm run qa`:

```
SAFETY   Isolation scan ................ ✅ 0 risky queries
         Cross-tenant data checks ...... ✅ all 0
MODULES  Stripe ........................ ✅ 31/31
         Bonzah ........................ ✅ 18/18
         BoldSign ...................... ✅ 22/22
         Uploads ....................... ✅ 12/12
FLOWS    Onboarding .................... ✅ 14/14
         Create rental ................. ✅ 26/26
→ safe to push
```

8. **After release**, a BoldSign outage at 2am → P1 push to Ghulam's phone → playbook
   says check BoldSign status, then retry the queued sends from Super admin.

---

## 16. Change log

Every rule change Ghulam agrees is recorded here, newest first.

| Date | Change |
|---|---|
| 2026-10-11 | Decided: modules "just in time" by importance, not all modules first. Six waves in MASTER_PLAN §6 (1 Notifications, 2 Onboarding, 3 Core business, 4 Rental lifecycle, 5 Communication & growth, 6 Reports & extras) |
| 2026-10-11 | Notifications go first: M4 = Email notifications (every email incl. OTP/auth), M6 = Push & in-app (in-app follows push settings). Wave 1 now starts with M4 + M6 in parallel. Module briefs are self-contained files in `QA/modules/` to hand to a worker AI (first: `M4-email-notifications.md`) |
| 2026-10-11 | QA docs moved to the root `QA/` folder. Added `QA/MODULES_AND_FLOWS.md` (the list of modules and flows, still a draft). Module checklists go in `QA/modules/<ID>-<name>.md` and are written to be handed to another AI session |
| 2026-10-11 | HARD RULE added (§2.0): every module and flow is tested end to end across LP, SA, OP, BS, CP + BE + MSG. `MASTER_PLAN.md` created: 17 modules, 23 flows rewritten across all apps, waves, parallel-session rules (coordinator/workers, claims, hot files, singletons, worktrees, prefixes). Wave 1 = F1's modules: M1, M4 → M17 → M7, M16 |
| 2026-10-11 | Guide created. Rules agreed: QA loop with AI self-pass and fixes first; strict checklist standard; modules before flows; golden tables + Vitest for all math; tenant isolation in 4 layers; one rule, one place; re-test packs; `npm run qa` parent command (manual only, safety → modules → flows); autofill wand rule; monitoring with a Super admin dashboard and push alerts to Ghulam's phone; Sentry planned |
