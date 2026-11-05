# M4 · Email notifications — module brief + checklist

**Status:** self-pass IN PROGRESS — run by the coordinator session (2026-10-11)
**Worker prefix:** `qa-m4` · **Claim file:** `QA/claims/M4.md`

---

## 0. Read this first (worker AI)

1. Read `QA/QA_GUIDE.md` in full, then `QA/MASTER_PLAN.md`, then `V2_PLAN.md` §0–§7.
   Everything there applies here. This file only adds what is specific to email.
2. You are the **worker for M4**. Create `QA/claims/M4.md` (format: MASTER_PLAN §5.2)
   before touching anything.
3. Address Ghulam by name, keep a soft friendly tone, and keep messages short:
   tables over prose, plain words, no jargon.
4. Your loop (QA_GUIDE §5):
   **self-pass (§6 below) → fix what you can → finish the checklist (§8) → tell Ghulam
   "ready for manual testing" → one step at a time → verify each step behind the scenes.**
5. Hard rules that bite in THIS module:
   - **Production, no staging.** A real notification fired for a real tenant reaches a
     real customer. Trigger sends **only on `northwind`**, only to the test inboxes in §7.
   - **Never change an existing edge function's behaviour for v1 tenants**
     (`V2_PLAN.md` §7). Fixes go in `-v2` functions or are gated to `northwind` by slug,
     unless Ghulam calls it a real v1 bug.
   - **Hot files** (MASTER_PLAN §5.3): `supabase/functions/_shared/resend-service.ts`,
     `_shared/email-template-service.ts`, `_shared/notification-email-layout-v2.ts`,
     both `lib/notifications-v2/*` copies. Ask the coordinator before editing any.
   - **Never print secrets** (API keys, hook secrets) in chat or files.
   - Do not commit or push. Do not run builds/typechecks unless Ghulam asks.

---

## 0.5 Decisions locked with Ghulam (2026-10-11)

| # | Decision |
|---|---|
| D1 | **Resend only, everywhere.** Remove AWS SES; move the direct `api.resend.com` callers onto the one shared sender. Global change, all tenants — approved |
| D2 | **Notification settings are the single source of truth, for ALL tenants** (global change, approved). Senders read them. **Safety:** for a tenant with no saved settings, the defaults must equal exactly what is sent today — nothing starts or stops sending on rollout |
| D3 | **Super admin has its own minimal notifications section** (`/admin/notifications`, exists): Drive247 → operators and operators → Drive247 only. It must actually control sending. Will grow later |
| D4 | **No super admin ↔ customer link** in email or push. The "Drive247 → everyone" group (announcements, maintenance banner) leaves the notification settings; announcements stay on their own page |
| D5 | **Customers control no notification settings** — verify nothing on BS/CP lets them |
| D6 | **"Emails (Resend)" tile on the super admin monitoring page**, fed by a log of every send |

## 1. Scope

**M4 = every email the platform sends, of every kind, from every app.**
Push and in-app notifications are **M6** (a separate brief). In-app follows push
settings, so it is out of scope here, but where one notification has email + push
channels, M4 tests the email channel and checks the switches don't interfere.

### 1.1 The five email families

| Family | What | Examples | Main code |
|---|---|---|---|
| **A. Auth & codes** | Codes and links that let people in | signup code, customer login/verify code, password reset, magic link, email change | `signup-begin`, `signup-verify-otp`, `_shared/signup-otp.ts`, `signup-password-reset` (web); `send-verification-otp`, `verify-otp`, `reset-password-with-otp` (booking); `custom-auth-email` (Supabase Auth hook) |
| **B. Company → customer** | A rental company tells its renter something | booking confirmed, agreement to sign, payment link, lockbox code, refund issued | ~25 `team_to_customer` items in the catalogue; `notify-*`, `send-*` functions |
| **C. Customer → company team** | The renter did something, the company's staff are told | new booking, payment failed, agreement signed, fine recorded | ~23 `customer_to_team` items; gated by the operator email switches |
| **D. Platform ↔ operators** | Drive247 talks to rental companies (and Drive247 staff) | "portal is ready", subscription link, Bonzah approved, support reply, daily onboarding digest | 20 items in the super-admin catalogue (`apps/admin/lib/notifications-v2/catalog.ts`) |
| **E. Other pipelines** | Separate senders with their own tables | invoice emails, signing emails, marketing emails, reminder emails, strategy-call emails, Trax support emails, contact form | `send-invoice-email`, `send-signing-email`, `marketing_emails`, `reminder_emails`, `strategy_call_emails`, `trax_support_email_jobs`, `send-contact-email` |

### 1.2 Every surface (the hard rule)

| Surface | What M4 must check there |
|---|---|
| **LP** landing | signup code email, password reset for signup, strategy-call emails, contact form |
| **SA** super admin | system notifications page (platform catalogue: switches, templates, test send), anything SA triggers that emails an operator (subscription link, Bonzah, support replies, announcements if emailed) |
| **OP** operator portal | Settings → Notifications (v1 page and v2 page on northwind): switches, templates, sender identity, test send; staff login / password reset / invite emails; every staff action that emails a customer |
| **BS** booking site | every customer action that emails the customer and/or the company team (booking, contact, enquiry) |
| **CP** customer portal | customer login / verify codes, password reset, actions that email the team (extension request, cancellation, uploads) |
| **BE** backend | providers, templates, recipient rules, gates, crons that send (reminders, digests), webhooks that send (Stripe, BoldSign) |
| **MSG** the inbox | arrives, not spam, correct sender, branding, links work, readable on phone + desktop + dark mode |

---

## 2. How email works today (map for the self-pass)

### 2.1 Providers

| Path | Count | Notes |
|---|---|---|
| `_shared/resend-service.ts` (`sendResendEmail` / `sendEmail`) | 62 functions | The intended single path |
| Direct calls to `api.resend.com` | 14 functions | Bypass the shared helper — duplication (QA_GUIDE §10) |
| AWS SES (`aws-ses-email` and signed SES requests) | 3 invokers + 4 files | Legacy; resend-service says Resend replaced SES |
| Supabase Auth → `custom-auth-email` hook | 1 | Auth emails; hook is enabled in prod |

`sendResendEmail` reports a **failure** when `RESEND_API_KEY` is missing (anywhere but
local) — good; verify every other path does the same.

### 2.2 Settings — two systems

| | v1 (all tenants) | v2 (northwind) |
|---|---|---|
| Operator email switch | `tenants.email_notifications_enabled` + `email_notification_prefs` (per category), checked by `isOperatorEmailEnabled` in ~10 senders | `tenant_notification_settings` (per key × channel) |
| Templates | `email_templates` + `_shared/email-template-service.ts` (`manage-email-template`, `render-email-template`) | `tenant_notification_settings.subject/body` + `lib/notifications-v2/email-layout.ts` / `_shared/notification-email-layout-v2.ts` |
| Sender identity | — | `tenant_email_sender` (from name, local part `@drive-247.com`, reply-to) |
| Operator recipient | `notification_recipient_email → contact_email → admin_email → env ADMIN_EMAIL` (`getTenantNotificationRecipient`) | same |
| Test send | — | `notification-test-v2`, logged in `notification_test_sends_v2` |
| Platform settings | — | `platform_notification_settings` (SA) |

### 2.3 Logs

| Table | State on 2026-10-11 |
|---|---|
| `email_logs` | 44 rows ever, **0 in the last 7 days** — not written by `resend-service` |
| `notification_test_sends_v2` | test sends only |
| Resend dashboard | today the only full record of what was sent |

### 2.4 Supabase Auth config (prod)

Send-email hook ON → `custom-auth-email`. Autoconfirm ON. Auth OTP: 6 digits, 1 h expiry.
Email rate limit 100/h. No custom SMTP. The hook **skips `signup` and `recovery`**
("handled via OTP") and sends `magiclink` and `email_change`.

---

## 3. Contract

**In:** a trigger (user action, staff action, cron, webhook) + tenant + recipient + data.
**Out:** exactly one email, to the right person, from the right sender, in the right
branding, with correct values and working links — or, if switched off, **none**.
**Never:** sent to the wrong tenant's customer; sent twice for one event; reported as
sent when it was not; a raw `{{variable}}` or `undefined`/`NaN`/`null` in the text; an
unescaped customer-typed value rendered as HTML.

Failure behaviour the module must have:

| Situation | Required behaviour |
|---|---|
| Resend down / 5xx / timeout | Caller gets a failure, nothing claims "sent"; the triggering action itself still succeeds (a booking is not lost because its email failed) |
| Resend 429 rate limit | Retried or reported; never silently dropped |
| API key missing | Failure reported (not simulated success) |
| Invalid / bouncing address | Failure recorded; no retry storm |
| Same trigger fired twice (webhook replay, double click) | One email |
| Switch off (v1 or v2) | No email |
| Template broken / missing variable | Falls back to the default template, never sends raw `{{…}}` |

---

## 4. Known findings to confirm (start of self-pass)

Each must be proven or disproven with evidence before anything else.

| ID | Finding (suspected) | Severity if true | How to confirm |
|---|---|---|---|
| **M4-F1** | **Portal staff "Forgot password" may send nothing.** Portal calls `supabase.auth.resetPasswordForEmail` (`apps/portal/src/app/(auth)/login/page.tsx:303`, `components/auth-v2/login-v2.tsx:517`); the hook skips every `recovery` email "handled via OTP", but the OTP reset path is booking-only | **P0** (staff locked out) | Read the hook end to end; trigger a reset for a northwind staff test user; check inbox + function logs |
| **M4-F2** | **v2 notification settings are not honoured at send time.** No sender reads `tenant_notification_settings` (only `notification-test-v2` does). Switching an email OFF on the v2 page may not stop it; custom v2 templates may never be used | **P0** for a switch that says off but sends | grep senders; flip one switch off on northwind, trigger, check inbox |
| **M4-F3** | **No log of sent emails.** `email_logs` unused for a week; nothing records sends except Resend | **P1** (cannot prove a customer was emailed; blocks monitoring) | Query `email_logs`; read `resend-service` |
| **M4-F4** | **Three separate code (OTP) systems** — signup (`_shared/signup-otp.ts`), customer (`verification_otps`), Supabase Auth OTP | **P1** (QA_GUIDE §10 duplication) | Compare TTL, attempt limits, resend cooldown, storage, rate limits |
| **M4-F5** | **Two providers + 14 direct Resend callers** bypassing the shared helper | **P1** (inconsistent failure handling, branding, logging) | List each, check its failure handling |
| **M4-F6** | `tenant_email_sender` has 0 rows — sender identity never set anywhere | P2 | Check v2 page saves it and senders use it |
| **M4-F7** | Portal and admin `lib/notifications-v2/catalog.ts` differ | P2 (if the tenant set drifted) | Diff the tenant catalogue part |

Add every new finding here with the next ID.

---

## 5. What "perfect" means for M4 (exit criteria on top of QA_GUIDE §7.5)

- [ ] Every catalogue key (48 tenant + 20 platform) and every family-A/E email is listed
      in the inventory (§8 Step 1) with its sender file, trigger and surface
- [ ] Every one that can be triggered on northwind has been received and checked (§8)
- [ ] Every switch, v1 and v2, proven to actually stop the email
- [ ] Every code email: correct TTL, attempt limit, cooldown, single-use, as documented
- [ ] All findings M4-F1…Fn closed (fixed, or accepted by Ghulam in writing)
- [ ] One send path (or a written merge plan approved by Ghulam) — QA_GUIDE §10
- [ ] Every send recorded somewhere queryable (needed for monitoring, §10)
- [ ] Rendering golden table 100% green (§9)
- [ ] SPF, DKIM, DMARC pass for `drive-247.com`; nothing lands in spam in Gmail and Outlook
- [ ] Re-test pack + monitors defined (§10)

---

## 6. Self-pass (worker AI, before Ghulam touches anything)

Do these in order. Record every result in this file.

1. **Inventory.** Build the full table for §8 Step 1: every email the platform can send
   → key/name, family, sender function (file:line), trigger (file:line), surface, recipient,
   provider path, gated by (v1/v2/none), template source, logged where.
   Cross-check: every function in `supabase/functions` that sends mail appears; every
   catalogue key maps to a real sender (the catalogue's `evidence` field helps).
2. **Confirm or kill M4-F1 … F7** (§4) with evidence.
3. **Provider paths.** For each path: failure handling, timeout, retries, what it returns,
   whether it can claim "sent" falsely.
4. **Gates.** For each sender: is it gated? by what? does the gate fail open or closed?
5. **Recipient rules.** Customer emails always go to the customer; operator emails follow
   the recipient rule; **every query filters by `tenant_id`** (QA_GUIDE §9).
6. **Templates.** Variables used vs variables resolved; missing-variable behaviour; HTML
   escaping of customer-typed values (names, messages, addresses).
7. **Codes (family A).** For each system: length, TTL, attempts, cooldown, single-use,
   rate limit, where stored, what the email says.
8. **Idempotency.** Webhook-triggered emails (Stripe, BoldSign, Bonzah): what stops a
   replay from emailing twice?
9. **Deliverability.** DNS for `drive-247.com`: SPF, DKIM (Resend), DMARC; from-addresses
   in use; reply-to.
10. **Fix** everything you can within the rules (§0). Log each fix in §11.
11. Write the golden table (§9), the automated tests and the monitors (§10).
12. Tell Ghulam: "M4 self-pass done — N findings, M fixed, K need you. Ready for manual testing."

---

## 7. Test data and safety

| Item | Value |
|---|---|
| Tenant | `northwind` only (prod id `6e5c544f-b374-451f-a662-360a634bff15`) |
| Test inboxes | Ghulam's Gmail with plus-aliases: `ilyasghulam35+qa-m4-<n>@gmail.com` (all arrive in one inbox, each looks like a different person). Ask Ghulam for an Outlook/Hotmail address for the spam check |
| Customers | Create on northwind with the wand (Add customer), email = a test alias above, name prefixed `QA M4` |
| Staff users | northwind test staff with test-alias emails, one per role |
| Never | trigger anything on a real tenant; email a real customer; change northwind's global email switches without holding the singleton (MASTER_PLAN §5.4); leave a switch changed |
| Restore | record every switch/template you change and put it back in the same session |
| Cleanup | delete `qa-m4` customers, rentals, users; confirm zero leftovers |

---

## 8. Checklist

Format per QA_GUIDE §7.1. Rows below are the **required skeleton**: the worker expands
Steps 3–5 to **one row per catalogue key**, using the inventory from Step 1.

### Step 1 · Inventory (C)

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-1.1 | Happy | Full email inventory table complete (§6.1) | every sender listed with trigger, surface, gate, template, log | C | P1 | |
| M4-1.2 | Happy | Catalogue ↔ code: every key has a real sender; every real sender is in the catalogue or explicitly listed as family A/E | no orphans either way | C | P1 | |
| M4-1.3 | Happy | Ghulam reviews the inventory | agrees nothing is missing | G | P1 | |

### Step 2 · Auth & codes (family A)

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-2.1 | Happy | LP signup code arrives | < 1 min, inbox not spam, 6 digits, branded Drive247 | G | P0 | |
| M4-2.2 | Boundary | Signup code: expired (10 min), 5 wrong tries, resend < 60 s and > 60 s, old code after resend | matches `_shared/signup-otp.ts` limits | G | P1 | |
| M4-2.3 | Happy | CP customer verify / login code arrives (booking site, northwind) | branded northwind, correct company name | G | P0 | |
| M4-2.4 | Boundary | Customer code: expiry, wrong tries, reuse after success | single use, limits enforced, clear messages | G | P1 | |
| M4-2.5 | Happy | CP customer password reset with code | email arrives, reset works, old password stops working | G | P0 | |
| M4-2.6 | Happy | **OP staff "Forgot password"** (v1 login and v2 login) | reset email arrives and works (M4-F1) | G | P0 | |
| M4-2.7 | Happy | OP staff magic link / invite (new staff user) | arrives, link logs in once, expires | G | P0 | |
| M4-2.8 | Happy | Email change for a staff user | confirmation to new address, change only after confirm | G | P1 | |
| M4-2.9 | Happy | SA login / password reset for super admin | works | G | P0 | |
| M4-2.10 | Security | Code for email A cannot verify email B; codes not in logs or URLs | refused | C | P0 | |
| M4-2.11 | Security | Rate limits on every code sender | repeated requests from one IP / email refused | C | P1 | |
| M4-2.12 | Message | Every auth email: wording, sender, branding, link domain, phone + dark mode | correct | G | P1 | |

### Step 3 · Company → customer (family B) — one row per key

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-3.`key` | Happy | Trigger on northwind (surface from inventory), customer = test alias | one email, right values, right branding, links open the right page | G | P0/P1 | |
| M4-3.`key`.db | Happy | — | send recorded; tenant = northwind; no second send | C | P1 | |
| e.g. M4-3.booking_confirmed_customer | Happy | Approve a pending booking in OP | customer gets "Booking confirmed" with dates, vehicle, total, link to CP | G | P0 | |

Plus, for the family as a whole:

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-3.90 | Negative | Customer with an invalid email | action still succeeds; failure recorded; no retry storm | C | P1 | |
| M4-3.91 | Interrupt | Double-click the triggering staff action | one email | G | P0 | |
| M4-3.92 | Security | Customer name `<b>x</b><script>`, message with HTML | shown as text, never rendered | G+C | P0 | |
| M4-3.93 | Isolation | Every family-B send names northwind and only northwind data | no other tenant's name, logo, data | C | P0 | |

### Step 4 · Customer → company team (family C) — one row per key

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-4.`key` | Happy | Trigger from BS / CP / automatic | team recipient (per rule) gets one email | G | P0/P1 | |
| M4-4.90 | Happy | Recipient rule: set `notification_recipient_email`, then clear it | goes to it; then falls back to contact → admin email | G+C | P1 | |
| M4-4.91 | Negative | v1 master switch off | no team emails | G+C | P0 | |
| M4-4.92 | Negative | v1 category off (each category) | that category stops, others continue | G+C | P1 | |

### Step 5 · Platform ↔ operators (family D) — one row per key

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-5.`key` | Happy | Trigger from SA / automatic, recipient = test alias | one email, Drive247 branding, correct operator | G | P0/P1 | |
| M4-5.90 | Happy | SA system notifications page: switch off a platform email, trigger it | not sent | G+C | P0 | |

### Step 6 · Settings, templates, sender (v2 page on northwind)

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-6.1 | Happy | Switch one email OFF on the v2 page, trigger it | **not sent** (M4-F2) | G+C | P0 | |
| M4-6.2 | Happy | Edit a template (subject + body with variables), trigger it | real email uses the edited template | G | P0 | |
| M4-6.3 | Happy | Reset template to default | default used again | G | P1 | |
| M4-6.4 | Happy | Send test from the page | arrives, matches the preview | G | P1 | |
| M4-6.5 | Boundary | Template with a missing variable, unknown `{{variable}}`, 5000-char body, emoji, Arabic | saved and rendered safely, or refused clearly | G | P1 | |
| M4-6.6 | Happy | Sender identity: from name, local part, reply-to | email shows them; replying goes to reply-to | G | P1 | |
| M4-6.7 | Negative | Local part with spaces / `@` / 100 chars | refused clearly | G | P2 | |
| M4-6.8 | Happy | Branding: logo, colours, contact details in the layout | match northwind settings | G | P1 | |
| M4-6.9 | Device | Every Step 6 email on Gmail web, Gmail iPhone, Outlook, dark mode | readable, buttons tappable | G | P1 | |

### Step 7 · Other pipelines (family E)

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-7.1 | Happy | Invoice email (OP → customer) | PDF / link opens, amounts match the invoice | G | P0 | |
| M4-7.2 | Happy | Signing email (agreement) | opens the signing page for the right rental | G | P0 | |
| M4-7.3 | Happy | Reminder emails (cron) | sent once at the right time, never to cancelled rentals | C | P1 | |
| M4-7.4 | Happy | Contact form on BS and LP | reaches the right inbox, reply-to = visitor | G | P1 | |
| M4-7.5 | Happy | Marketing / strategy-call / Trax support emails | each sends once, logged in its own table | C | P2 | |

### Step 8 · Failure and deliverability

| ID | Type | Check | Expected | Who | Pri | Result |
|---|---|---|---|---|---|---|
| M4-8.1 | Negative | Provider failure simulated (Vitest mock): 5xx, timeout, 429, missing key | failure reported, triggering action not lost, no false "sent" | C | P0 | |
| M4-8.2 | Interrupt | Replay a Stripe / BoldSign webhook that emails | one email | C | P0 | |
| M4-8.3 | Happy | SPF, DKIM, DMARC for `drive-247.com` | pass (check headers of a received email) | C | P1 | |
| M4-8.4 | Happy | Gmail and Outlook placement | inbox, not spam / promotions | G | P1 | |
| M4-8.5 | Happy | Every link in every email | HTTPS, right domain (tenant subdomain or drive-247.com), lands on the right page logged in or at login | G+C | P0 | |

---

## 9. Golden table — rendering (no prices, but values must be exact)

The worker drafts; **Ghulam confirms the "correct" column**. Vitest checks the renderers
(`_shared/email-template-service.ts` and `notification-email-layout-v2.ts`) against it.

| # | Input | Correct output |
|---|---|---|
| 1 | amount 700, currency USD | Ghulam decides: `$700.00` or `700 USD` |
| 2 | amount 1234.5, GBP | |
| 3 | amount 0 | |
| 4 | pickup 2026-03-08 09:00 in a tenant on US Eastern (DST change day) | |
| 5 | rental 1 day vs 2 days wording | |
| 6 | customer name `O'Brien & <Sons>` | escaped, shown literally |
| 7 | missing `{{vehicle_reg}}` | fallback text, never `{{vehicle_reg}}` / `undefined` |
| 8 | Arabic company name, RTL | |
| 9 | very long vehicle name (80 chars) | wraps, no overflow |
| 10 | link variable with query string | stays a valid URL |

---

## 10. What M4 leaves behind

**Automated (joins `npm run qa`):**
- Rendering golden table (Vitest)
- Provider failure tests (mocked Resend: 5xx, timeout, 429, missing key)
- Gate logic: v1 master/category switch, v2 per-key switch, recipient rule
- Catalogue consistency: every key has a sender; portal and admin tenant catalogues agree
- Code systems: TTL / attempts / cooldown unit tests

**Short manual pass (Ghulam, ~10 min):** M4-2.1, 2.3, 2.6, one family-B key, one family-C
key, M4-6.1, M4-8.4.

**Monitors (QA_GUIDE §13):**

| Monitor | Alert |
|---|---|
| Resend API reachable + send failure rate (last 15 min) | P0 if sends failing > 5% |
| Code emails: sent → verified ratio (last hour) | P1 if it drops sharply (codes not arriving) |
| Bounce / complaint rate (Resend webhooks) | P2 above threshold |
| Hook `custom-auth-email` errors | P0 |
| Cron senders (reminders, digest) ran on time | P1 if missed |

---

## 11. Self-pass log (worker fills in)

| Date | Finding / fix | Files | Notes |
|---|---|---|---|
| 2026-10-11 | Inventory: **~85 edge functions send email**; no app sends mail directly (all via edge functions) | — | per-function table in scratch, to be added as §8 Step 1 |
| 2026-10-11 | **SES still live (3 paths):** `aws-ses-email` called by portal Quotes page (`app/(dashboard)/quotes/page.tsx:358`) and CMD verification (`cmd-create-verification`, `cmd-resend-link`); `send-stripe-onboarding-email` signs SES directly and has **no caller** (orphan); `apps/portal/src/lib/services/email-service.ts` uses SES and has **no importer** (orphan). AWS SES secrets are set in prod | as listed | D1: move to Resend, delete orphans |
| 2026-10-11 | ~25 functions import only `corsHeaders` from `_shared/aws-config.ts` | — | harmless, but the import must move when SES goes |
| 2026-10-11 | **Direct Resend callers (bypass shared sender):** auto-extend-rentals, sandbox-auto-extend-rentals, diag-resend-delivery, hyper-api, resend-email, send-auto-extension-reminder, send-booking-email, send-conversation-message-v2, send-cp-enquiry, send-email-message, send-user-welcome-email, send-verification-link-v2 | as listed | D1: move onto shared sender |
| 2026-10-11 | **M4-F1 CONFIRMED in code:** hook `custom-auth-email` returns without sending for every `recovery`; portal v1 + v2 login "Forgot password" use `resetPasswordForEmail` → staff get no reset email. Only the booking site has the OTP reset path | `custom-auth-email/index.ts:243-256` | P0 — needs a live confirm (manual) then fix |
| 2026-10-11 | **M4-F2 CONFIRMED:** no sender reads `tenant_notification_settings` or `platform_notification_settings`; only `notification-test-v2` reads tenant settings | — | P0 per D2 |
| 2026-10-11 | **M4-F3 CONFIRMED:** `resend-service` never writes `email_logs`; 0 rows in 7 days | `_shared/resend-service.ts` | blocks D6 monitoring |
| 2026-10-11 | **M4-F8 (P0 security) — auth email hook unsigned:** `custom-auth-email` is public (`verify_jwt=false`) and never checked Supabase's signature, though `SEND_EMAIL_HOOK_SECRET` is set → anyone could make Drive247 send a branded reset/login email with their own link to any address. **Fixed in code** (Standard Webhooks verify, refuse when secret missing) — not deployed | `custom-auth-email/index.ts` | deploy with fix 1 |
| 2026-10-11 | **M4-F1 fixed in code:** hook now sends `recovery`; staff fallback redirect → `{slug}.portal.drive-247.com/reset-password` (super admin → admin login); redirect host check parses the URL instead of `includes()`; company name HTML-escaped — not deployed | `custom-auth-email/index.ts` | portal `/reset-password` + auth allow-list already match |
| 2026-10-11 | **M4-F9 (P1 security):** `email_logs` has RLS off and anon holds full INSERT/SELECT/UPDATE/DELETE — 44 rows (recipient emails, Jan 2026) readable/writable with the public key | `public.email_logs` | proposed: revoke anon/authenticated; table otherwise unused |
| 2026-10-11 | **M4-F3 fix in code:** new closed table `email_send_log` (RLS on, service-role writes, super-admin reads) + `recordSend` in `sendResendEmail` (sent/failed, best effort). Migration `supabase/migrations/PENDING_20261011_email_send_log.sql.txt` — not applied | `_shared/resend-service.ts` | takes effect per function on redeploy |
| 2026-10-11 | **M4-F10 (P0 security) — open email relays:** `aws-ses-email` and `resend-email` accept any to / subject / HTML / from and check no caller; `verify_jwt=true` is satisfied by the PUBLIC anon key → anyone can send any email as drive-247.com. `send-booking-email` and `hyper-api` send a branded booking email to any address with caller-supplied names. `resend-email`, `send-booking-email`, `hyper-api`, `send-stripe-onboarding-email` have **no callers** in the repo | those functions | proposed: undeploy the 4 orphans; lock `aws-ses-email` to staff + Resend, then replace |
| 2026-10-11 | Gate coverage: only 14 senders check the v1 operator switch (`isOperatorEmailEnabled`); only ~20 use the template service; 1 uses the v2 layout | — | feeds D2 wiring plan |

## 12. Bug log

Format: QA_GUIDE §7.4.

| Bug | Row | Pri | Steps to reproduce | Expected | Actual | Evidence | Fix | Re-tested |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## 13. Report back to the coordinator

When signed off, update `QA/claims/M4.md` to `signed off` and post a five-line summary:
findings, fixes, files touched, what is in the re-test pack, open P2/P3s.
