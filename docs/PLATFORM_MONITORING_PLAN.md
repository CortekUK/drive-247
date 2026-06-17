# Platform Rental Monitoring & Tenant Readiness — Design Plan

**Status:** Proposed (awaiting approval)
**Author:** Ghulam + Claude
**Date:** 2026-06-06
**Scope chosen:** Both subsystems, unified · Verdict email per rental · Plan-first

---

## 1. Goal

Give the super-admin (you) eyes on **every rental created across every tenant**, and catch
tenants who are misconfigured (test mode where it should be live) **before it causes real damage**.

Two subsystems, one feature:

| # | Subsystem | Question it answers | Shape |
|---|-----------|--------------------|-------|
| ① | **Rental Event Stream** | "What rentals are being created right now, and is anything wrong with them?" | Per-rental, real-time. Email + unified admin tab. |
| ② | **Tenant Readiness Board** | "Which tenants are not fully live right now?" | Per-tenant, continuous. Standalone admin board. |

They connect at one point: **when a rental is created, we snapshot the readiness verdict onto the
rental** — so each email carries a ✅/🔴 verdict and we keep a permanent audit.

**Design stance:** passive monitor, *not* a gate. We observe and alert; we never block rental
creation. You handle issues manually for now.

---

## 2. The critical architectural decision: capture via DB trigger, not app code

Rentals are inserted from **7+ places** with no shared choke point:

- `apps/portal/src/app/(dashboard)/rentals/new/page.tsx` (staff-created)
- `apps/booking/src/components/MultiStepBookingWidget.tsx`
- `apps/booking/src/components/BookingWidget.tsx`
- `apps/booking/src/components/EnhancedBookingWidget.tsx`
- Edge functions / webhooks (`stripe-webhook-live`, `create-additional-drivers`, …)

➡️ **We hook into Postgres, not the apps.** A trigger on `INSERT INTO rentals` fires once, no matter
which path created the rental. Impossible to bypass; future creation paths are covered automatically.

```
INSERT INTO rentals
      │
      ├─ BEFORE INSERT trigger  → compute readiness snapshot from tenant config
      │                            write rentals.creation_context (jsonb) + rentals.health_severity
      │                            (synchronous, in-DB, guaranteed — survives email failure)
      │
      └─ AFTER INSERT trigger   → pg_net http_post → edge fn `platform-rental-notify`
                                   (async, non-blocking) → sends verdict email
```

---

## 3. Data model changes

### 3a. Snapshot on the rental (immutable audit)

Migration adds to `rentals`:

| Column | Type | Purpose |
|--------|------|---------|
| `creation_context` | `jsonb` | Frozen snapshot of every integration's mode/state at the moment of creation |
| `health_severity` | `text` | `ok` \| `warning` \| `critical` — computed verdict, drives email + dashboard color |

Example `creation_context`:
```json
{
  "stripe":       { "mode": "test", "onboarding_complete": true,  "status": "active" },
  "boldsign":     { "mode": "test", "rental_mode": "test", "live_brand": false },
  "bonzah":       { "enabled": true, "mode": "test", "insurance_on_rental": true },
  "subscription": { "status": "active", "stripe_mode": "live", "plan": "premium" },
  "modives":      { "environment": "production" },
  "is_production_tenant": true,
  "computed_severity": "critical",
  "reasons": ["Stripe in TEST — payment not real", "BoldSign in TEST — agreement auto-deletes in 14d"]
}
```

### 3b. Tenant Readiness as a SQL view (no new table)

A database **view** `v_tenant_readiness` computes per-integration live/test status across all tenants.
Super-admin reads it directly (super admins bypass RLS). No table to keep in sync — it's always live.

### 3c. (Optional) notification log

Tiny `platform_notifications` table (`rental_id`, `channel`, `sent_at`, `error`) only if you want
delivery tracking / retries. **Recommend deferring** to v2 — the snapshot already records what happened.

---

## 4. Readiness verdict logic (exact rules)

### Per-integration "live & ready" definition

| Integration | Live-ready when | Source columns |
|-------------|-----------------|----------------|
| **Stripe Connect** | `stripe_mode='live'` AND `stripe_onboarding_complete=true` AND `stripe_account_status='active'` | `tenants` |
| **BoldSign** | `boldsign_mode='live'` AND `boldsign_live_brand_id` not null | `tenants` (+ `rentals.boldsign_mode` per rental) |
| **Bonzah** | *only if* `integration_bonzah=true`: `bonzah_mode='live'` AND credentials set | `tenants` |
| **Subscription** | `tenant_subscriptions.status IN ('active','trialing')` AND `subscription_stripe_mode='live'` | `tenant_subscriptions`, `tenants` |
| **Modives/CMD** *(bonus)* | `modives_config.environment='production'` | `modives_config` |

### "Production tenant" heuristic (decides critical vs warning)

A tenant is treated as **production** if their subscription is `active`/`trialing` in **live** Stripe mode
(i.e. they're really paying to be on the platform). For a production tenant, a test-mode integration on a
real rental is **critical**. For a tenant still onboarding, the same is a **warning**.

### Per-rental severity at creation

| Severity | Triggers |
|----------|----------|
| 🔴 **critical** | Production tenant + ANY of: Stripe test · BoldSign test · (Bonzah test **while** rental has insurance, i.e. `insurance_premium>0` / `insurance_status` set) |
| 🟡 **warning** | Subscription `past_due`/`canceled`/none · trial expiring soon · `$0` total / no payment captured · Stripe onboarding incomplete · non-production tenant in test mode |
| 🟢 **ok** | All applicable integrations live |

Extra signals worth flagging (cheap, high value):
- **First rental ever** for a tenant → milestone tag in email/dashboard
- **Test-mode rental from a "live" tenant** → the contradiction is the alarm (already → critical)
- **$0 / no payment captured** → warning

---

## 5. Verdict email (per rental — your chosen cadence)

One email per rental creation. Subject line carries the verdict so you triage from the inbox:

```
🟢  [Drive247] RevTek · R-2041 · all systems live
🔴  [Drive247] Jangram · R-88 · REAL rental created with BoldSign in TEST
```

Body:
- Tenant, rental number, customer, vehicle, dates, total
- **Verdict block** — per-integration ✅/⚠️ list with the `reasons[]`
- Deep link → the rental in the super-admin unified tab

**Built on existing infra:** `notify-*` edge functions + `_shared` email service (AWS SES /
`resend-service.ts`). New edge fn `platform-rental-notify` reuses these.

> **Scaling exit (planned, not v1):** keep real-time email for 🔴 critical only; roll 🟢/🟡 into a
> daily digest once volume climbs. The `reminders-digest` function is the pattern to copy.

---

## 6. Super-admin UI (apps/admin)

### 6a. Unified Rentals tab — `app/admin/(protected)/platform-rentals/`

Cross-tenant table of every rental (super-admin bypasses RLS):

- **Columns:** Severity dot · Rental # · Tenant · Customer · Vehicle · Dates · Total · Status · Created
- **Filters:** Tenant (dropdown) · Customer (search) · **Rental reference # (`rental_number`)** · Severity · Date range
- Row click → rental detail drawer showing the full `creation_context` verdict
- Default sort: newest first; critical rentals surfaced/badged at top

Follows portal design system (flat, 1px `#f1f5f9` borders, indigo `#6366f1` accent, DM Sans,
`#eef2ff` table headers).

### 6b. Tenant Readiness Board — `app/admin/(protected)/readiness/`

One row per tenant from `v_tenant_readiness`:

| Tenant | Stripe | BoldSign | Bonzah | Subscription | Overall |
|--------|--------|----------|--------|--------------|---------|
| RevTek | 🟢 live | 🟢 live | 🟢 live | 🟢 active/live | ✅ Ready |
| Jangram | 🟢 live | 🔴 test | — n/a | 🟢 active/live | ⚠️ 1 issue |

- Sort issues to the top; filter by "has issues"
- This catches misconfig **before a tenant's first rental** — the "before anything happens" goal

---

## 7. Edge function(s)

| Function | JWT | Purpose |
|----------|-----|---------|
| `platform-rental-notify` | No (called by pg_net w/ secret header) | Receives rental id from AFTER-INSERT trigger; builds verdict email; sends via SES/Resend to super-admin address |

Verification: pg_net passes a shared secret header; function rejects without it. (Same posture as
the webhook functions that self-verify.)

---

## 8. Build order (phased, each independently shippable)

1. **Migration** — `creation_context` + `health_severity` on `rentals`; `v_tenant_readiness` view; the BEFORE/AFTER triggers + verdict-compute SQL function.
2. **Edge fn** — `platform-rental-notify` (verdict email). Wire pg_net.
3. **Admin: Readiness Board** — read-only, no dependencies, fastest win.
4. **Admin: Unified Rentals tab** — cross-tenant table + filters + detail drawer.
5. **Polish** — first-rental milestone, $0 flag, email deep links, severity sorting.

---

## 9. Open questions for you

1. **Recipient(s):** which email address(es) get the verdict emails? Just yours, or a list?
2. **Bonzah "in use":** confirm the per-rental signal for "customer bought insurance" — I'll use
   `insurance_premium > 0` OR `insurance_status` set. OK?
3. **Notification log table:** skip for v1 (recommended) or include delivery tracking now?
4. **Modives/CMD:** include in readiness board now, or defer (it's a bonus)?
5. **Where does the admin nav link live** — top-level sidebar items, or under an existing group?
```
