# RETENTION_PLAN.md

How Drive247 implements the **Customer Retention & UX PRD v1.0** (3 Oct 2026,
`~/Downloads/Drive247_Customer_Retention_UX_PRD_v1.0.pdf`). Written 2026-10-06
against production. Read `V2_PLAN.md` first. Every rule in it applies here.

---

## 0. Where we actually start from

Production on 2026-10-06: **39 live subscriptions, 40 cancelled.** Churn is the
real problem this PRD is aimed at.

More of the PRD already exists than the PRD assumes:

| PRD asks for | What already exists | Gap |
|---|---|---|
| Cancellation form + save flow | `billing-v2/cancel-flow-dialog-v2.tsx`: reasons, ticket + call, 10% × 3 bills offer | The reason is free text inside `go_live_requests.note` and gets parsed back out with a regex. There's no structured data, no `cancellation.started` event, and only one hard-coded offer |
| Customer health score | `tenant_health_snapshots` / `tenant_health_incidents` / `health_score_settings` (activity-change score) | **Has not run since 2026-09-03** (no cron). It only measures activity, not the PRD's six signals |
| Onboarding / setup status | `setup_checklist_items`, `tenant_onboarding_checklist`, admin `/onboarding`, `onboarding_followups`, `onboarding-daily-digest`, dashboard-v2 `setup-guide` | No per-milestone `due_at` / SLA and no customer-facing milestone emails |
| Book a call | strategy-call funnel (GHL) for sales; "book a call" inside the cancel flow | No persistent Help entry with categories |
| NPS | `tenant_feedback.rating` column (0 rows rated) | No survey, cadence or detractor queue |
| Repeat renter codes | `promocodes` (28 rows), automations engine (`automation-*`) | No "rental completed → send return code" recipe |
| Beta hub / What's new | `feature_announcements`, `portal_announcements` | No "join beta / I want this" |
| Creator rewards | referral engine + tiers (`referral-*`) | Content submissions are not rewarded |
| White-label | custom domains (DB + middleware live) | Packaging, scope and pricing |
| Billed / renewal emails | `subscription-webhook` stores invoices; `notify-subscription-activated` only | **No renewal reminder and no "you were billed" email** |

**Principle:** extend what exists. Do not build a second copy of anything
listed above.

---

## 1. Verdict on all 34 strategies

`BUILD` = new software. `EXTEND` = finish what exists. `OPS` = mostly a people or
content job; the product only gives it a link or a slot. `PARK` = not now.
`DECIDE` = blocked on a decision from Ghulam (§4).

### P0: Retention foundation

| # | Strategy | Verdict | Notes |
|---|---|---|---|
| — | Lifecycle events + account timeline (§6, §16) | **BUILD — first** | The PRD's sequencing note: nothing else gets built until this exists |
| 02 | Signup email sequence | BUILD | Runs on the lifecycle engine; skips steps already done |
| 24 | Setup completion emails + SLA | EXTEND | Add `due_at`/owner to the setup milestones, plus an overdue queue |
| 04 | Renewal reminders | BUILD | 3 days before `current_period_end`; derived by cron, **not** by editing `subscription-webhook` |
| 05 | Billed emails | BUILD | From paid `tenant_subscription_invoices` rows, with idempotency on the invoice id |
| 12 | Book a call in portal | EXTEND | Help menu entry → 4 categories → scheduling link carrying the tenant context |
| 13 | Hotline number | BUILD (small) · DECIDE | Number + staffed hours must be confirmed first |
| 09 | Cancellation form | EXTEND | Store reasons in a structured way; fire the `cancellation.started` event when the dialog opens |
| 10 | Tiered retention offers | EXTEND · DECIDE | Replace the hard-coded 10% × 3 with a rules table (tenure, reason, cooldown, max) |
| 23 | Downgrade / pause | BUILD · DECIDE | `change-subscription-plan-v2` exists; pause rules need a decision |
| 16 | 5-day trial | **DECIDE** | Conflicts with the current $1 → refund → 1-month upfront model. Run only as a cohort experiment |
| 31 | Health score | EXTEND | Reschedule it; add the 6 weighted signals (onboarding 20, activity 20, bookings 25, billing 15, support 10, NPS 10) |
| 31b | Value dashboard | EXTEND | Card on dashboard-v2: bookings, GMV, repeat renters, messages sent, leads vs the previous period. No "money saved" |
| 33 | Cancellation intelligence | BUILD | Admin page: churn by reason/tenure/plan/source/health, plus CSV |
| 32 | 30/60/90 lifecycle | BUILD | Playbook on the engine: staff tasks plus automated touches |

### P1: Engagement & revenue

| # | Strategy | Verdict | Notes |
|---|---|---|---|
| 25 | NPS programme | EXTEND | Day 14 → 45/60 → quarterly; detractor → admin queue; promoter → review ask |
| 17 | Milestone celebrations | BUILD | First booking, 10/50/100, first repeat renter, 6 months. Banner plus optional email, once each |
| 19 | Repeat renter loyalty codes | EXTEND | Automation recipe on `rental.completed` using the existing `promocodes` |
| 18 | AI abandoned booking recovery | BUILD (L) | Needs a booking-site abandonment capture, a resume token and consent. Trax answers only from approved FAQs |
| 26 | Quarterly progress + anniversary | BUILD (small) | Reuses the value metrics; skipped when the numbers are empty or falling |
| 22 | Trustpilot workflow | BUILD (small) | Triggered by NPS ≥ 9 or a milestone, with a cooldown |
| 23b | Testimonial capture | BUILD (small) | Admin flag + consent record on the tenant |
| 14 | Rental tips / Learning Hub | BUILD + OPS | Help → Learning Hub; content written by CS |
| 01 | Webinar poll | BUILD (small) | Reuses the `portal_announcements` slot |
| 06 | Weekly webinars | OPS + small BUILD | Schedule, registration link, replay list in the Learning Hub |
| 03 | Marketing instruction emails | OPS + engine | Content is a CS job; sending is the lifecycle engine |
| 29 | Sunday newsletter | OPS | Sent from the email tool CS already uses; product only links to the archive |
| 21 | Private community | OPS | One link in Help, shown after activation |
| 27 | Birthday / business milestone | BUILD (small) | Optional founding-date field; no personal birthday required |
| 15 | Meta Ads under DCA | **PARK** | Needs a Meta API integration and an attribution decision |

### P2: Expansion

| # | Strategy | Verdict |
|---|---|---|
| 07 | Client advisory board | EXTEND (admin tag + notes) |
| 08 | Creator rewards | EXTEND referrals (later) |
| 11 | Tenure loyalty pricing | PARK · DECIDE (benefits / margin) |
| 20 | Google Ads + SEO package | PARK (ops-led service) |
| 28 | Beta / waitlist hub | EXTEND `feature_announcements` |
| 30 | White-label premium | PARK · DECIDE (scope + price) |

---

## 2. Architecture (how it is built safely)

All additive, per V2_PLAN §4–§7.

```
existing tables ──(pg_cron, every 15 min, SQL)──► tenant_lifecycle_events
(tenants, tenant_subscriptions,                        │  idempotent: UNIQUE dedupe_key
 tenant_subscription_invoices, rentals,                │
 go_live_requests, setup data, feedback)               ▼
                                         lifecycle consumers (new -v2 functions)
app events (cancel dialog opened,          · messaging (emails, Trax voice, logged)
 NPS answered…) ──► same table             · health score v2
                                           · milestones
                                           · admin: timeline, queues, churn page
```

- **Events are derived, not hooked.** One new SQL function reads existing
  tables and inserts events with `ON CONFLICT (dedupe_key) DO NOTHING`. No
  trigger goes on any existing table and no v1 edge function is edited, so
  `subscription-webhook` and the rest stay untouched. Because it's derived,
  **history backfills itself**, and every tenant gets a timeline on day one.
- **Every message sent is an event** (`communication.sent`), which is how the
  PRD's "everything in the timeline" acceptance criterion is met.
- **Operator-facing UI is v2-only** (northwind first), built in new files.
  Internal admin tooling lives in `apps/admin`.
- **Emails speak as Trax**: first person, no emojis, and they never admit fault.
  They go to **northwind only** until widened.

---

## 3. Build order

| Step | Build | Status |
|---|---|---|
| 1 | `tenant_lifecycle_events` + derive job + admin **Account timeline** | **done 2026-10-06**: applied to prod, 531 events backfilled, cron `lifecycle-derive-events` every 15 min; admin tenant page → Timeline |
| 2 | Billing transparency: renewal reminder + billed email (northwind first) | |
| 3 | Cancel flow v2 → structured reasons, `cancellation.started`, offer rules table | |
| 4 | Health score v2 (6 signals) + reschedule + admin at-risk queue | |
| 5 | Value card on dashboard-v2 | |
| 6 | Setup milestones with SLA + signup sequence + 30/60/90 playbook | |
| 7 | Cancellation intelligence page (admin) | |
| 8 | Help menu: Book a call, hotline, Learning Hub, community link | |
| 9 | NPS + detractor queue + review ask | |
| 10 | Milestones, loyalty-code recipe, quarterly progress | |
| 11 | Abandoned booking recovery | |

---

## 4. Decisions needed from Ghulam (block only the steps named)

| Decision | Blocks | My recommendation |
|---|---|---|
| What counts as "activated" | 4, 6 | Setup complete **and** first completed rental |
| Pause: allowed? max length? access while paused? | 3 | Up to 2 months, read-only portal, booking site offline, no data deleted |
| Save-offer limits | 3 | ≤ 20% for ≤ 3 bills automatically; anything more goes to admin approval; 6-month cooldown |
| Hotline number + staffed hours | 8 | Show it only once hours are confirmed |
| Scheduling tool for "Book a call" | 8 | The GHL calendar already used for strategy calls |
| 5-day trial vs the current upfront model | — | Keep the current model; trial only as a later cohort test |
| Who receives at-risk / detractor alerts | 4, 9 | Same recipients as `health_score_recipients` |
