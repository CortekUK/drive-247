# Drive247 — Complete System Flow Map (Operator → Customer)

Built from a full codebase sweep (6 parallel mapping passes) + direct verification of the payment spine. **🔌 = touches the Stripe connected account** (the points the BYO/Standard migration changes).

> **Verified payment facts (grepped directly, not inferred):**
> - Connected accounts are **Express** (`type:'express'`, `create-connected-account/index.ts`).
> - All booking charges are **DIRECT charges on the operator's account** (`{ stripeAccount: accountId }` via `getConnectAccountId()`), NOT destination charges.
> - **ZERO `application_fee`** anywhere in the codebase → platform takes **no per-transaction cut**; 100% of every booking lands in the operator's account. Platform earns **only** from the monthly subscription.
> - Test mode: all tenants share `STRIPE_TEST_CONNECT_ACCOUNT_ID`. Live: each tenant uses its own Express account.
> - Platform **subscription** billing is a **separate Stripe account** (own keys), unrelated to Connect.

---

# PART A — OPERATOR JOURNEY (setup → go-live)

### A1. Tenant creation (super-admin)
- **Who/Where:** Super-admin · `apps/admin/app/admin/(protected)/rentals/page.tsx`
- **Action:** "Add New Rental" → company name, slug, contact email, type → calls `admin-create-user` (role `head_admin`).
- **Tables:** `tenants`, `app_users`, `audit_logs`.

### A2. Tenant population (script, optional)
- `scripts/tenant-onboarding.mjs` + `tenant-onboarding-config.json` → branding, CMS, locations, FAQs, testimonials, extras. Idempotent.
- **Tables:** `tenants`, `cms_pages`, `cms_page_sections`, `pickup_locations`, `faqs`, `testimonials`, `rental_extras`.

### A3. Subdomain → tenant resolution
- Middleware (`apps/portal/src/middleware.ts`, `apps/booking/src/middleware.ts`) extracts slug from subdomain (or custom-domain lookup) → `x-tenant-slug` header. `TenantContext` loads full tenant.

### A4. First login + gates
- **Where:** `apps/portal/src/app/(auth)/login/page.tsx` → `(dashboard)/layout.tsx`.
- **Gates:** policy-acceptance (`check-policy-acceptance`), subscription gate (soft for never-subscribed, hard block for expired), forced password change (`must_change_password`).
- **Role routing:** head_admin/admin/manager → `/`; ops → `/vehicles`; viewer → `/reports`.

### A5. Setup Hub (trial/test mode)
- `components/dashboard/setup-hub.tsx` + `use-setup-status.ts`. Tracks 2 items: **Stripe Connect active** + **Bonzah configured**. Countdown to `trial_ends_at`.

### A6. 🔌 Stripe Connect setup (operator collects booking money)
- **Where:** Settings → Payments · `components/settings/stripe-connect-settings.tsx`.
- **Action:** "Set Up Stripe Connect" → `create-connected-account` creates an **Express** account (`card_payments`+`transfers` capabilities) → hosted onboarding link (`get-connect-onboarding-link`) → operator completes KYC on Stripe.
- **Sync:** `stripe-connect-webhook` (`account.updated`) sets `stripe_account_status='active'`, `stripe_onboarding_complete=true`. Helpers: `check-stripe-connection`, `sync-stripe-account`, `delete-connected-account`.
- **Tables:** `tenants` (`stripe_account_id`, `stripe_account_status`, `stripe_onboarding_complete`, `stripe_mode`).
- **➡️ BYO change:** Express(platform-created) → **Standard(operator-owned via OAuth)**.

### A7. Other integration setup
- **Bonzah insurance** (`bonzah-settings.tsx`): `bonzah_mode`, `bonzah_username`. · **BoldSign e-sign** (`esign-settings.tsx`): `boldsign_mode`, brand ids. · **Twilio SMS / Meta WhatsApp** (messaging). · **Tesla Fleet**.

### A8. Fleet & pricing setup
- **Vehicles:** `vehicles/page.tsx` + `add/edit-vehicle-dialog` → `vehicles`, `vehicle_photos`. Availability toggles `available_daily/weekly/monthly`.
- **Pricing:** base daily/weekly/monthly; dynamic (`weekend_surcharge_percent`, `tenant_holidays`, `vehicle_pricing_overrides`); `min_rental_days/hours`; Trax suggestions.
- **Locations:** `pickup_locations` + modes (fixed/custom/multiple/area); tiered delivery (`delivery_distance_tiers`).
- **Blocked dates** (`blocked_dates`), **Lockbox** config (`lockbox_templates`, vehicle `lockbox_code`).

### A9. Go-live (test → live)
- **Subscription-driven (automatic):** first real `invoice.paid` (trialing→active) flips `stripe_mode='live'`, `bonzah_mode='live'`, sets `setup_completed_at` (`subscription-webhook`).
- **Stripe Connect live:** requires onboarding complete; `go-live-banner.tsx`.

### A10. 💳 Platform subscription (Drive247 charges the operator) — SEPARATE Stripe acct
- Super-admin creates plans (`manage-subscription-plans`) → operator subscribes (`create-subscription-checkout`, `pricing-card.tsx`) → `subscription-webhook` (checkout.session.completed/invoice.paid/updated/deleted). $1 validate→refund, then first real charge. Portal mgmt: `create-subscription-portal-session`, `get-subscription-details`.
- **Tables:** `subscription_plans`, `tenant_subscriptions`, `tenant_subscription_invoices`.
- **➡️ BYO change:** none structurally — works on any account incl. UAE.

---

# PART B — CUSTOMER (RENTER) JOURNEY (browse → paid)

### B1. Browse fleet
- `apps/booking/src/app/page.tsx`, `/fleet/page.tsx`, `MultiStepBookingWidget.tsx`. Filters by make/colour/location/dates; hides blocked/unavailable. **Reads:** `vehicles`, `vehicle_photos`, `pickup_locations`, `testimonials`.

### B2. Dates, locations, pricing
- `apps/booking/src/app/booking/page.tsx` + `stores/booking-store.ts`. Pricing engine `lib/calculate-rental-price.ts`: tier (daily<7 / weekly / monthly), weekend/holiday surcharge, unlimited-mileage upgrade, extras, delivery fee, tax, service fee, promo. Validates min age, lead time, min/max duration. **Deposit is NOT in the upfront total** (held later).

### B3. Customer auth / signup
- `stores/customer-auth-store.ts` → `customer-signup` (cross-tenant + orphan self-heal), OTP (`send-verification-otp`/`verify-otp`). Links `auth.users` → `customer_users` → `customers`. Blocked-customer checks.

### B4. Insurance (Bonzah)
- `BonzahInsuranceSelector.tsx` + `useBonzahPremium` → `bonzah-calculate-premium`; quote at checkout `bonzah-create-quote`; activated post-payment `bonzah-confirm-payment`. **Skipped** for insurance-exempt tenants (`config/tenant-config.ts`).

### B5. 🔌 Checkout + payment — **3 PATHS** (the spine)
- **Decider:** `BookingCheckoutStep.tsx` → installments? → `create-installment-checkout`; else `payment_mode='manual'`? → `create-preauth-checkout`; else → `create-checkout-session`. (`get-booking-mode` resolves auto/manual.)
- **All paths:** create Stripe Checkout **on the operator's connected account** (`{ stripeAccount: getConnectAccountId(tenant) }`), `setup_future_usage:'off_session'` (save card for deposit hold). Pre-auth uses `capture_method:'manual'`.
- **Branches:** enquiry tenant → $0, no charge, rental status `Enquiry`; deposit notice shown if `security_deposit_enabled`; auto-extend rentals skip deposit hold.
- **Tables:** `rentals` (status `Pending`), `payments`, `rental_extras`, `customers`.
- **➡️ BYO change:** identical mechanics — already direct charges on the operator account.

### B6. 🔌 Post-payment webhook
- `stripe-webhook-test` / `stripe-webhook-live` (`checkout.session.completed`, routes via `event.account`). Detects preauth/installment/extension/excess-mileage/credit. → `apply-payment` (FIFO allocate to ledger) → `place-deposit-hold` (if flagged) → `bonzah-confirm-payment` → confirmation emails.

### B7. Confirmation
- `/booking-success` (paid) · `/booking-pending` (manual review) · `/booking-enquiry-submitted` (enquiry). Booking email + optional SMS.

---

# PART C — RENTAL LIFECYCLE (post-booking → close)

### C1. 🔌 Approval / capture
- Portal `pending-bookings/page.tsx` → `capture-booking-payment` (captures the manual-capture PI **on the connected account**) or `cancel-booking-preauth`. Rental → `Active`, vehicle → `Rented`. (Reject path voids the auth.)

### C2. Agreement signing (BoldSign)
- Portal/booking `api/esign/route.ts` → BoldSign send (mode/brand per tenant, `DisableEmails:true`) → `send-signing-email` + `send-signing-whatsapp`. `boldsign-webhook` downloads signed PDF → `customer_documents`, updates `rental_agreements`/`rentals.document_status`. Original vs extension agreements. **Signing ≠ activation.**

### C3. Identity verification
- **Veriff:** `create-veriff-session` → `veriff-webhook`. · **CMD/Modives:** `cmd-create-verification` → `cmd-webhook` (HMAC, `cmd_webhook_events`). · **AI:** `create-ai-verification-session` → `ai-document-ocr` + `ai-face-match`. **Table:** `identity_verifications`.

### C4. Key handover / collection
- Lockbox: `notify-lockbox-code` (email/SMS/WhatsApp from `lockbox_templates`), `lockbox_send_log`, scheduled `send-lockbox-scheduled`; collection `send-collection-whatsapp`. Handover photos (`key-handover-photos.tsx`); marking "giving" complete = **true activation** (starts PAYG, places deposit hold).

### C5. 🔌 Deposit lifecycle
- **Place** (`place-deposit-hold`): manual-capture PI **on connected account**, extended auth (~30d), idempotent. Skips auto-extend/extended rentals/$0. · **Refresh** cron (`refresh-deposit-holds`) before expiry. · **Capture** (`capture-deposit-hold`) on return, partial + refund remainder. · **Release** (`release-deposit-hold`) cancels PI.
- **Fields:** `rentals.deposit_hold_*`. **➡️ BYO change:** runs on operator's own account either way — survives.

### C6. 🔌 Extensions
- `create-extension-checkout` (Checkout **on connected account**) → `rental_extensions`, `payments`. Auto-extension cron charges upfront weekly. Optional extension agreement (BoldSign). FIFO-isolated allocation.

### C7. PAYG (pay-as-you-go)
- `accrue-payg-charges` cron (per-tenant window) posts daily Rental+Tax+ServiceFee to ledger (idempotent by day index, 30-day catch-up cap). Reminders (`send-payg-reminders`). `finalize-payg-rental` posts pro-rated final day + closes.

### C8. 🔌 Returns / finalize
- `close-rental-dialog.tsx` → status `Closed`, vehicle `Available`. Excess mileage (`calculate-excess-mileage` → `send-excess-mileage-payment-link`). Fines/damage → ledger, deductible from deposit hold. Return handover triggers deposit capture.

### C9. 🔌 Refunds
- `process-refund` (Stripe refund **on connected account**, deposit-first then PI), `schedule-refund`, `reverse-payment`. Extension refunds scoped by `extensionId`.

### C10. Reviews
- `rental_reviews` (operator rates customer 1–10) → `generate-review-summary` (OpenAI) → `customer_review_summaries`.

---

# PART D — NOTIFICATIONS (cross-cutting)
- **Channels:** Email (Resend, `_shared/resend-service.ts`), SMS (Twilio BYO, gated `integration_twilio_sms` + `sms_consent`), WhatsApp (Meta/Twilio, gated `integration_whatsapp`).
- **Spine:** booking pending/approved/rejected/cancelled, payment verification/rejection, identity verified, signing sent/completed, lockbox/collection, preauth expiring, rental started/reminder/return-due, extension, completion, fine, PAYG/installment reminders, excess mileage, refund, invoices.
- **Templates:** defaults in `_shared/email-template-service.ts`; per-tenant overrides in `email_templates`.
- ⚠️ *Note: some `notify-*` function names in this section were agent-reported and should be spot-checked against `supabase/functions/` before being quoted in customer docs.*

---

# PART E — 🔌 CONNECT TOUCHPOINTS (what the BYO/Standard migration changes)
Every place the operator's connected account is used today:
1. **A6** Connect onboarding (Express → **Standard OAuth**)
2. **B5** Booking checkout (3 paths) — already direct charges ✅
3. **B6** Payment webhook routing (`event.account`)
4. **C1** Booking payment capture
5. **C5** Deposit hold place / refresh / capture / release
6. **C6** Extension checkout
7. **C8** Excess-mileage / fine charges
8. **C9** Refunds

**Unaffected:** platform subscription (A10), fleet/pricing/CMS setup, verification, notifications, agreements, reviews. **No `application_fee` to rework** (none exists).

---

*Sources: full-codebase mapping sweep, 2026-06. Payment spine (charge model, no app-fee, Express+direct) verified directly via grep. A handful of peripheral edge-function names (notifications) were agent-reported — verify before publishing externally.*
