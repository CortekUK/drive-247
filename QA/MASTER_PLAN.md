# Drive247 QA Master Plan

What gets tested, in what order, and how several AI sessions work in parallel without
conflicts. Rules for *how* to test live in `QA_GUIDE.md`; this file is *what* and *when*.

> **AI sessions:** read `QA_GUIDE.md` first, then this file. Only the **coordinator**
> session edits this file and the guide (§5).

---

## 1. The hard rule — end to end, across every app

**Every module and every flow is tested across ALL five surfaces. Nothing missed.**

| Code | Surface | App | Who uses it |
|---|---|---|---|
| **LP** | Landing page | `apps/web` (drive-247.com) | Visitors, prospective operators |
| **SA** | Super admin | `apps/admin` | Drive247 staff (Ghulam) |
| **OP** | Operator portal | `apps/portal` (`{slug}.portal.drive-247.com`) | Rental operators and their staff |
| **BS** | Booking site | `apps/booking` (`{slug}.drive-247.com`) | Renters booking a car |
| **CP** | Customer portal | `apps/booking` `/portal` | Renters after booking |

Plus the two invisible surfaces every flow also touches:

| Code | Surface |
|---|---|
| **BE** | Backend: edge functions, database, crons, webhooks |
| **MSG** | What leaves the system: emails, SMS, push notifications |

For every module and flow, the checklist must answer for **each** surface: *does this
touch it, and what must be true there?* A surface that is not touched is written down
as "not touched — checked", never left out.

---

## 2. Modules

| ID | Module | Kind | Has math | Surfaces |
|---|---|---|---|---|
| **M1** | Auth & roles — signup identity, email code, login, magic link, password reset, roles (head_admin/admin/manager/ops/viewer), manager permissions, customer auth, super admin | Ours | | LP SA OP BS CP BE MSG |
| **M2** | Pricing engine — rental price, days/hours, tiers, weekend/holiday, overrides, extras, tax | Ours | ✅ | OP BS CP BE |
| **M3** | Uploads & storage — licences, selfies, vehicle photos, documents, logos, buckets | Ours | | SA OP BS CP BE |
| **M4** | Email notifications — every email of every kind: auth & codes (OTP), company→customer, customer→team, platform↔operators, other pipelines; settings, templates, sender, delivery. Brief: `QA/modules/M4-email-notifications.md` | 3rd party (Resend) | | all |
| **M5** | SMS (Twilio) | 3rd party | | OP BS CP BE MSG |
| **M6** | Push & in-app notifications — Web Push + the bell; in-app follows push settings | Ours | | SA OP CP BE MSG |
| **M7** | Platform billing — Stripe signup payment, subscriptions, plans, invoices, subscription webhook, reconciler, gates | 3rd party | ✅ | LP SA OP BE MSG |
| **M8** | Booking payments — Stripe Connect charges, deposits/holds, refunds, payouts | 3rd party | ✅ | SA OP BS CP BE MSG |
| **M9** | Square payments | 3rd party | ✅ | OP BS CP BE |
| **M10** | BoldSign agreements | 3rd party | | SA OP BS CP BE MSG |
| **M11** | Bonzah insurance | 3rd party | ✅ | SA OP BS CP BE MSG |
| **M12** | ID verification — AI document check, face match | 3rd party | | OP BS CP BE |
| **M13** | Accounting — Xero / Zoho | 3rd party | | OP BE |
| **M14** | Turo bridge | 3rd party | | OP BE |
| **M15** | Realtime messaging | Ours | | OP CP BE MSG |
| **M16** | Promo & referral codes — platform promo codes, referral programme, tiers, discounts | Ours | ✅ | LP SA OP BE MSG |
| **M17** | Tenant provisioning — building a tenant: row, owner, plan, branding palette, booking-site content, starter credits (shared by self-serve signup and sales onboarding) | Ours | | SA OP BS CP BE |

---

## 3. Flows — rewritten end to end

Each flow lists what must be true on every surface.

### Group A — Platform

**F1 · Onboarding** — from a super admin plan to a live tenant. *Detailed in §4.*

**F2 · Subscription lifecycle** — renewal, failed payment, grace window, hard gate, resubscribe, cancel.
| LP | SA | OP | BS | CP | BE / MSG |
|---|---|---|---|---|---|
| — | tenant list status chip, detail page, invoices, timeline | sidebar chip (Live / Setup / Payment due / Overdue), gate dialog, `/subscription` | site stays up / behaviour when gated | unaffected for renters | webhook, reconciler, invoice trigger, emails |

**F3 · Super admin tenant management** — view, edit, impersonate, suspend, delete a tenant.
| LP | SA | OP | BS | CP | BE / MSG |
|---|---|---|---|---|---|
| — | rentals list + detail, all tabs | reflects edits | reflects edits | reflects edits | foreign keys on delete, audit log |

### Group B — Operator setup

**F4 · Settings & branding** — company details, branding, payments, integrations.
| SA | OP | BS | CP |
|---|---|---|---|
| sees changes | settings tabs | colours, logo, content, contact details | same branding |

**F5 · Add vehicle** — create, photos, prices, availability.
| SA | OP | BS | CP |
|---|---|---|---|
| tenant vehicle count | vehicles list + detail | appears in fleet with correct price | appears on bookings |

**F6 · Add customer + ID check**
| SA | OP | BS | CP |
|---|---|---|---|
| — | customers list + detail, verification | customer can log in / book | profile, documents |

**F7 · Staff users & permissions**
| SA | OP |
|---|---|
| admins page | users page, manager permissions, what each role sees |

### Group C — Rental lifecycle

| Flow | SA | OP | BS | CP | MSG |
|---|---|---|---|---|---|
| **F8 · Create rental (portal)** | platform rentals | create, detail page, payment, agreement, insurance | vehicle blocked for those dates | booking visible | confirmation, agreement email |
| **F9 · Customer booking (site)** | platform rentals | pending booking appears, approve | search → book → pay → sign | booking appears | confirmation, receipts |
| **F10 · Handover** (in person / lockbox) | — | key handover section | — | instructions | lockbox code email/SMS |
| **F11 · Extension** | — | extend, price, payment | — | request extension | notices |
| **F12 · Return & close + review** | — | close, mileage, damage, review | vehicle free again | history | receipt |
| **F13 · Cancel & refund** | — | cancel, refund | dates free again | status | refund notice |
| **F14 · Invoices, fines, payments** | — | invoices, fines, payments | — | pay invoice / fine | invoice emails |

### Group D — Communication

| Flow | SA | OP | BS | CP | MSG |
|---|---|---|---|---|---|
| **F15 · Messages** | — | messages | — | chat | push / email |
| **F16 · Announcements** | announcements page | banner, dialogs, feature deck | — | customer announcements | — |
| **F17 · Notifications & reminders** | system notification settings | notification settings, reminders | — | notices | email, SMS, push |

### Group E — Money & reports

| Flow | SA | OP |
|---|---|---|
| **F18 · Finances, insights, P&L, reports** | platform finance | finances, insights, P&L, reports |
| **F19 · Expenses** | — | expenses |

### Group F — Customer side

| Flow | BS | CP |
|---|---|---|
| **F20 · Customer portal** | login | bookings, documents, gig driver, profile |

### Group G — Growth

| Flow | LP | SA | OP | BS |
|---|---|---|---|---|
| **F21 · Referrals & promo codes** | referral link `/r/{code}`, code at signup | promo codes, referral sync | referrals page | — |
| **F22 · CMS / booking site editing** | — | — | CMS editor | pages update |
| **F23 · Leads, enquiries, quotes** | strategy call | sales, contacts | leads, enquiries, quotes | enquiry forms |

---

## 4. F1 · Onboarding — end to end

**Start:** super admin sets up a signup plan. **End:** the new operator is live —
logged into their portal, with a booking site and customer portal that work.

### 4.1 Journey across every surface

| # | Surface | What happens | Behind it |
|---|---|---|---|
| 1 | **SA** | Signup Plans: name, price, bullets, visible, highlighted | `manage-signup-plans`, `signup_plans`, Stripe prices |
| 2 | **SA** | Promo codes ready to use at signup | `admin-promo-codes` |
| 3 | **LP** | Pricing shows the plans; `/r/{code}` referral link lands with the code applied | `signup_plans` (ISR ~1 min), `promo-code-lookup` |
| 4 | **LP** | Account: name, email, password, company, web address, terms | `signup-slug-check`, `signup-begin` |
| 5 | **MSG** | 6-digit code email | `signup-begin` / `signup-verify-otp` (Resend) |
| 6 | **LP** | Enter the code | `signup-verify-otp` |
| 7 | **LP** | Payment, with promo/referral code | `signup-payment-intent(-v2)`, Stripe (UAE account) |
| 8 | **LP** | Building the workspace; resume after a closed tab | `signup-provision`, `signup-resume` |
| 9 | **BE** | Tenant, owner (`head_admin`), plan, subscription, first invoice, branding, booking-site content, starter credits | `_shared/tenant-provisioning.ts`, `add_credits` |
| 10 | **BE** | Subscription webhook and hourly reconciler agree with the DB; referral engine records the referral | `subscription-webhook`, `reconcile-subscriptions`, `referral-engine` |
| 11 | **MSG** | "Your Drive247 portal is ready" email | `signup-provision` (Resend) |
| 12 | **OP** | Lands logged in (magic link), right slug, v2 portal, status chip, first-run wizard | `generateLink`, `portal_experience = v2` |
| 13 | **OP** | Logs out and back in with email + password; password reset works | Supabase Auth, `signup-password-reset` |
| 14 | **OP** | Subscription page shows plan, amount, discount, invoice | `get-subscription-details` |
| 15 | **OP** | Referrals page shows their own referral code | `tenant-referrals` |
| 16 | **BS** | `{slug}.drive-247.com` loads with company name, branding, published pages, empty fleet handled | tenant row + CMS content |
| 17 | **CP** | Customer portal login page loads on the new tenant, branded | customer auth |
| 18 | **SA** | New tenant in the rentals list with correct status chip, plan, amount; detail page; lifecycle timeline shows the signup; referrer sees the referral | `tenant_lifecycle_events`, subscription realtime |

### 4.2 Modules F1 depends on

| Order | Module | Why F1 needs it | Parallel? |
|---|---|---|---|
| 1 | **M1 Auth & roles** | signup user, email code, magic-link handoff, password login/reset, `head_admin` role, super admin view | ✅ with M4 |
| 1 | **M4 Email** | code email, "portal is ready" email, invoice/receipt emails | ✅ with M1 |
| 2 | **M17 Tenant provisioning** | builds the tenant, branding, booking-site content, credits | after M1 |
| 3 | **M7 Platform billing** | plans, signup payment, subscription, invoices, webhook, reconciler | after M17 |
| 3 | **M16 Promo & referral codes** | promo at checkout, referral link, referral engine, discount math | ✅ with M7 |

When all five are signed off, F1 runs as a flow using `flows/onboarding.md`, which will
be extended to cover rows 2, 3, 10, 13–18 above.

---

## 5. Parallel sessions — no conflicts

### 5.1 Roles

| Role | Who | Owns |
|---|---|---|
| **Coordinator** | The main session | `QA_GUIDE.md`, `MASTER_PLAN.md`, `MODULES_AND_FLOWS.md`, claims, merges, starting workers |
| **Worker** | One AI session per module or flow | Its own checklist, its own status file, fixes inside its own flow map |
| **Ghulam** | — | Manual testing for every session, final say |

### 5.2 Claims

Every active item has a claim file: `QA/claims/<ID>.md` (one file per item, so two
sessions never edit the same file).

```
item:      M1 Auth & roles
session:   worker-2
worktree:  ../drive-247-qa-m1
prefix:    qa-m1
files:     (flow map — the only files this session may edit)
singletons:(any held, see 5.4)
status:    self-pass | ready for manual | testing step N | signed off
```

### 5.3 File rules

1. A worker edits **only** files in its claim's flow map.
2. **Hot files** are claimed separately and held by one session at a time:
   - `apps/portal/src/app/(dashboard)/layout.tsx`
   - any `supabase/functions/_shared/*` helper
   - pricing calculators (all copies) and `shared/`
   - contract twins (`lib/announcements/contract.ts` ×2)
   - `apps/*/src/integrations/supabase/types.ts`
   - `package.json` / lockfiles
3. Need a file someone else holds → stop and ask the coordinator.
4. Database changes (additive only) go through the coordinator, one at a time.

### 5.4 Singletons — one session at a time

| Singleton | Why |
|---|---|
| Rehearsal email (`dev_signup_rehearsal`) | One address, one reset |
| northwind global settings (branding, payment mode, integrations) | Changing them changes every other test |
| Stripe / BoldSign / Bonzah test webhook endpoints | Shared by all tests |
| Signup plans on the live landing page | Real visitors see them |

### 5.5 Git

- Each worker works in its **own git worktree** (a separate copy of the repo).
- Nothing is committed or pushed without Ghulam's go-ahead.
- The coordinator merges worktrees one at a time, then runs `npm run qa`.

### 5.6 Test data

- Every session uses its own prefix (`qa-m1-…`, `qa-f5-…`) for emails, slugs and names.
- Cleanup only ever deletes the session's own prefix.
- All testing on `northwind` (or rehearsal-built tenants), never on a real operator.

### 5.7 Ghulam's capacity

AI self-passes run in parallel without limit. At most **2–3 sessions** wait on Ghulam's
manual testing at the same time.

### 5.8 Starting a worker session

Paste into a new session:

> Read `QA/QA_GUIDE.md` and `QA/MASTER_PLAN.md` and build your context from
> them. You are a worker for **<ID> <name>**. Create your claim file, then start the QA
> loop at the self-pass. Edit only files in your flow map, use prefix `qa-<id>`, and
> ask before touching a hot file or singleton.

---

## 6. Waves

Modules "just in time": each wave finishes the modules its flows need, then tests those
flows straight away. Modules inside a wave are independent and can run in parallel
sessions; a flow starts only when all its modules are signed off.

| Wave | Theme | Modules (first, parallel) | Then flows |
|---|---|---|---|
| **1** | Notifications | M4 Email · M6 Push & in-app | — (every flow needs them) |
| **2** | Onboarding | M1 Auth & roles · M17 Provisioning · M7 Platform billing · M16 Promo & referral | F1 Onboarding · F2 Subscription lifecycle · F3 Super admin tenant management |
| **3** | Core business | M2 Pricing · M3 Uploads · M8 Booking payments · M10 BoldSign · M11 Bonzah · M12 ID verification | F4 Settings & branding · F5 Add vehicle · F6 Add customer · F7 Staff & permissions · F8 Create rental · F9 Customer booking |
| **4** | Rental lifecycle | M5 SMS | F10 Handover · F11 Extension · F12 Return & close · F13 Cancel & refund · F14 Invoices, fines, payments · F20 Customer portal |
| **5** | Communication & growth | M15 Messaging | F15 Messages · F16 Announcements · F17 Notifications & reminders · F21 Referrals & promo · F22 CMS · F23 Leads, enquiries, quotes |
| **6** | Reports & extras | M9 Square · M13 Accounting · M14 Turo | F18 Finances & reports · F19 Expenses |

Inside wave 2, M1 goes before M17 (provisioning creates the owner login).

---

## 7. Status

| ID | Status | Session | Signed off |
|---|---|---|---|
| M4 Email notifications | **Brief written — ready for a worker** | — | — |
| M6 Push & in-app | Next brief | coordinator | — |
| M1 Auth & roles | Waiting | — | — |
| M17 Tenant provisioning | Waiting (after M1) | — | — |
| M7 Platform billing | Waiting | — | — |
| M16 Promo & referral | Waiting | — | — |
| F1 Onboarding | Checklist v1 written; to extend per §4.1 | — | — |
| All others | Not started | — | — |
