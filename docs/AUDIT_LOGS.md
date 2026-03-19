# Audit Logs

Audit logs are written to the `audit_logs` table. Every row captures who did what, on which entity, for which tenant.

## Table Schema

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `action` | text | Snake-case verb (see action catalogue below) |
| `actor_id` | uuid \| NULL | `app_users.id` of the portal staff member. NULL for system/cron/customer-initiated actions |
| `entity_type` | text | Category of the affected record (`payment`, `rental`, `vehicle`, etc.) |
| `entity_id` | uuid | ID of the affected record |
| `tenant_id` | uuid | Always set — every row is tenant-scoped |
| `details` | jsonb | Action-specific payload (amounts, reasons, IDs, etc.) |
| `created_at` | timestamptz | Auto-set by DB |

---

## How Logging Works

Two patterns are used depending on whether the action originates from a portal staff session or from a background/customer process.

### Pattern A — Portal call site (`useAuditLog` hook)
Used when a logged-in portal staff member triggers the action. The hook reads `actor_id` from `useAuth()` and `tenant_id` from `useTenant()`.

```typescript
// apps/portal/src/hooks/use-audit-log.ts
const { logAction } = useAuditLog();

logAction({
  action: "payment_reversed",
  entityType: "payment",
  entityId: paymentId,
  details: { amount, reason },
});
```

If `tenant` or `appUser` is not yet loaded, `logAction` silently no-ops — it never throws.

### Pattern B — Edge function direct insert
Used for cron jobs, booking-app flows, and rejection pipelines where no portal session exists. `actor_id` is explicitly `null`.

```typescript
// Inside a Supabase Edge Function
await supabase.from('audit_logs').insert({
  action: 'installment_payment_processed',
  actor_id: null,          // system/cron — no staff actor
  entity_type: 'payment',
  entity_id: payment?.id,
  tenant_id: installment.tenant_id,
  details: { ... },
}).catch(e => console.error('[Audit]', e));
```

The `.catch` ensures audit failures never break the main operation.

---

## Action Catalogue

### Pre-existing (logged before this work)

| Action | Entity Type | Actor | Logged In | Notes |
|---|---|---|---|---|
| `payment_created` | `payment` | staff | `add-payment-dialog.tsx` | Manual payment recorded by staff |
| `payment_refunded` | `payment` | staff | `refund-dialog.tsx` | Refund processed via the refund dialog |
| `payment_captured` | `payment` | staff | `use-booking-approval.ts` | Stripe pre-auth captured on booking approval |
| `fine_authority_payment` | `fine` | staff | `authority-payment-dialog.tsx` | Payment made directly to authority for a fine |

---

### Payment Category — Added in audit logging pass (2026-03-18)

#### `payment_reversed`
A manual (non-Stripe) payment was reversed. All charge allocations are undone and the payment is marked `Reversed`.

- **Actor:** portal staff (always has actor)
- **Logged in:** `apps/portal/src/app/(dashboard)/payments/page.tsx`
- **Trigger:** Payments page → `⋯` menu → Reverse Payment

```jsonc
// details
{
  "amount": 500,
  "reason": "Payment entered in error",
  "applications_reversed": 2      // number of charge allocations undone
}
```

---

#### `deposit_deducted`
Security deposit was deducted (partially or fully) to cover an outstanding charge.

Two call sites — same action, different `entity_id` semantics:

| Source | `entity_type` | `entity_id` | Logged In |
|---|---|---|---|
| Rental detail page (manual) | `payment` | `rental.id` | `rentals/[id]/page.tsx` |
| Key handover (auto, excess mileage) | `rental` | `rental.id` | `use-key-handover.ts` |

- **Actor:** portal staff (always has actor)

```jsonc
// details — manual deduction from rental page
{
  "amount": 150,
  "stripe_refund_id": "re_xxx"   // present if Stripe refund was created
}

// details — key handover excess mileage deduction
{
  "amount": 80,
  "reason": "excess mileage deduction"
}
```

---

#### `payment_refunded` (key handover deposit return)
Security deposit automatically refunded when keys are returned and rental is closed. Separate from the `refund-dialog` path.

- **Actor:** portal staff (always has actor)
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`
- **Trigger:** Rental detail → Key Handover → Mark Key Received (when `security_deposit > 0`)

```jsonc
// details
{
  "category": "Security Deposit",
  "reason": "deposit returned on key handover",
  "amount": 500
}
```

---

#### `payment_captured` (manual verification)
A pending payment was manually approved by staff. Fires immediately after the `approve_payment` RPC succeeds — before `apply-payment` allocation runs — so the audit trail exists even if allocation fails.

- **Actor:** portal staff (always has actor)
- **Logged in:** `apps/portal/src/hooks/use-payment-verification.ts`
- **Trigger:** Payments page → green ✓ button on a Pending Review payment

```jsonc
// details
{
  "method": "manual_verification"
}
```

---

#### `payment_captured` (Stripe webhook fallback)
A Stripe checkout payment was confirmed on the rental detail page. Only fires when the Stripe webhook has not already allocated the payment (i.e. the fallback `apply-payment` call runs).

- **Actor:** portal staff (always has actor)
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx` (`processStripePayment`)
- **Trigger:** Returning to rental detail after Stripe checkout completes (when webhook is slow)

```jsonc
// details
{
  "method": "stripe_checkout",
  "source": "webhook_fallback"
}
```

---

#### `installment_paid_early`
A customer paid one or more installments early from the booking app customer portal. No staff actor — customer-initiated.

- **Actor:** NULL (customer action via booking app)
- **Logged in:** `supabase/functions/pay-installment-early/index.ts`
- **Trigger:** Booking app → Customer Portal → Payments → Pay Now

Two sub-flows covered — both log the same action:

| `action` param | Description |
|---|---|
| `pay-single` | Customer pays one specific installment early |
| `pay-remaining` | Customer pays all remaining installments at once |

```jsonc
// details — pay-single
{
  "customer_id": "uuid",
  "installment_id": "uuid",
  "amount": 250,
  "installment_number": 3,
  "payment_intent_id": "pi_xxx"
}

// details — pay-remaining
{
  "customer_id": "uuid",
  "installment_plan_id": "uuid",
  "amount": 750,
  "installments_paid": 3,
  "payment_intent_id": "pi_xxx",
  "action": "pay_remaining"
}
```

---

#### `installment_payment_processed`
A scheduled installment was successfully charged by the cron job. One row per installment per run.

- **Actor:** NULL (cron/system)
- **Logged in:** `supabase/functions/process-installment-payment/index.ts`
- **Trigger:** Cron scheduler (daily), or manual invocation via Supabase dashboard / CLI

```jsonc
// details
{
  "installment_id": "uuid",
  "installment_number": 2,
  "amount": 300,
  "payment_intent_id": "pi_xxx",
  "is_retry": false             // true if this was a retry of a previously failed installment
}
```

---

#### `installment_payments_refunded`
All paid installments for a rental were refunded on Stripe and the installment plan was cancelled. Logged once per rental cancellation/rejection.

- **Actor:** NULL (called from rejection pipeline — `rejection-dialog` logs `rental_cancelled` separately)
- **Logged in:** `supabase/functions/refund-installment-payments/index.ts`
- **Trigger:** Portal → Rental detail → Reject booking (when an installment plan exists)

```jsonc
// details
{
  "plan_id": "uuid",
  "total_refunded": 850,
  "refunded_count": 3,          // number of installments refunded on Stripe
  "reason": "Booking rejected/cancelled"
}
```

> **No duplicate risk:** `rejection-dialog.tsx` logs `rental_cancelled` for the rejection itself. `installment_payments_refunded` covers only the financial refund totals — two distinct facts, two distinct rows.

---

#### `payment_created` (Stripe checkout initiated from Add Payment dialog)
A Stripe checkout session was created from the portal's Add Payment dialog. Fires as soon as the checkout tab opens — before the customer completes payment. The matching `payment_captured` row arrives later when the webhook lands.

- **Actor:** portal staff (always has actor)
- **Logged in:** `apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx`
- **Trigger:** Rental detail / Payments → Add Payment → Stripe tab → Open Stripe Checkout

```jsonc
// details
{
  "amount": 500,
  "method": "stripe_checkout",
  "rental_id": "uuid",           // present if tied to a rental
  "customer_id": "uuid"
}
```

---

#### `payment_created` (extension checkout initiated)
A Stripe checkout session was created for a rental extension payment. Fires only when `extensionTotalAmount > 0` and the checkout URL is successfully returned. Two call sites — same action, same details shape.

- **Actor:** portal staff (always has actor)
- **Logged in:**
  - `apps/portal/src/components/rentals/ExtensionRequestDialog.tsx` (customer-requested extension, staff approves)
  - `apps/portal/src/components/rentals/AdminExtendRentalDialog.tsx` (admin-initiated extension)
- **Trigger:**
  - Rental detail → Extensions tab → Approve (customer request)
  - Rental detail → Extend Rental button (admin direct)

```jsonc
// details
{
  "amount": 300,
  "method": "stripe_checkout_extension",
  "rental_id": "uuid"
}
```

> Free extensions (`extensionTotalAmount = 0`) skip checkout creation entirely — no log row is produced for those.

---

#### `credit_wallet_purchased`
A Stripe checkout session was created to purchase portal credits. Fires when the checkout URL is returned and the user is redirected — before payment completes.

- **Actor:** portal staff (always has actor)
- **Logged in:** `apps/portal/src/hooks/use-credit-wallet.ts`
- **Trigger:** Portal → Credits page (`/credits`) → Buy Credits → redirected to Stripe

```jsonc
// details
{
  "credits": 100,
  "checkout_session_id": "cs_xxx"
}
```

---

---

### Rental Category — Added 2026-03-18

#### `rental_updated` (status sync)
Background effect auto-corrects rental status to Active when all conditions
(approved + fulfilled + key handed) are already met but the DB row is stale.

- **Actor:** portal staff (fires within their session)
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx` (`syncStatusToActive`)
- **Trigger:** Rental detail page load when status is stale

```jsonc
{ "status": "Active", "trigger": "status_sync" }
```

---

#### `rental_closed` (renewal source auto-close)
When a renewal rental is activated, its source rental is automatically closed.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx`

```jsonc
{ "trigger": "renewed_by", "renewed_by_rental_id": "uuid" }
```

---

#### `payment_captured` (manual pre-auth)
Staff approves a pending booking where payment mode is `manual` and the
Stripe pre-auth still requires capture. Fires only when capture is triggered.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx` (Approve dialog)

```jsonc
{ "method": "manual_capture" }
```

---

#### `rental_approved`
Staff manually approves a pending booking from the rental detail inline dialog.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx`

```jsonc
{ "became_active": true }   // false if key handover not yet done
```

---

#### `rental_closed` (inline close)
Staff closes a rental from the inline Close Rental dialog on the rental detail
page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx`

```jsonc
{ "trigger": "inline_close" }
```

---

#### `rental_deleted` (inline)
Staff deletes a rental from the inline Delete Rental dialog on the rental detail
page. Calls `delete_rental_cascade` RPC directly.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx`

```jsonc
{ "customer": "John Smith", "vehicle_reg": "AB12 CDE" }
```

---

#### `payment_failed`
Staff rejects a pending payment during manual payment verification.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-payment-verification.ts`

```jsonc
{ "reason": "Receipt does not match claimed amount" }
```

---

#### `rental_started`
Keys are handed to the customer and the rental transitions to Active.
Only fires when `approval_status = approved` and `payment_status = fulfilled`.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`

```jsonc
{ "trigger": "key_handover_giving" }
```

---

#### `rental_closed` (key handover)
Keys are returned by the customer and the rental transitions to Closed.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`

```jsonc
{ "method": "key_handover" }
```

---

#### `rental_updated` (undo key handover)
Staff unmarks the key-given handover, reverting an Active rental back to Pending.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`

```jsonc
{ "action": "undo_key_handover", "type": "giving" }
```

---

#### `rental_updated` (mileage)
Return mileage is recorded for the receiving handover.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`

```jsonc
{ "action": "mileage_updated", "handover_type": "receiving", "mileage": 45230 }
```

---

#### `document_uploaded`
A handover photo is uploaded for either the giving or receiving handover.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`

```jsonc
{ "handover_type": "giving", "file_name": "front-left.jpg" }
```

---

#### `document_deleted`
A handover photo is deleted.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-key-handover.ts`

```jsonc
{ "handover_type": "receiving", "file_name": "rear-damage.jpg" }
```

---

#### `rental_review_submitted`
Staff submits a rating (1–10) and optional comment/tags for a customer after a rental.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-rental-review.ts`

```jsonc
{ "rating": 8, "customer_id": "uuid", "tags": ["punctual", "clean"] }
```

---

#### `rental_review_skipped`
Staff skips the review prompt without rating.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-rental-review.ts`

```jsonc
{ "customer_id": "uuid" }
```

---

#### `insurance_purchased`
A Bonzah insurance policy was purchased for a rental from the portal.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/buy-insurance-dialog.tsx`

```jsonc
{
  "premium": 49.99,
  "coverage": { "cdw": true, "rcli": false, "sli": true, "pai": false },
  "policy_record_id": "uuid",
  "policy_active": true
}
```

---

#### `installment_plan_activated`
An installment plan was activated and the rental `payment_status` set to `fulfilled`.

- **Actor:** NULL (customer-initiated / Stripe webhook)
- **Logged in:**
  - `supabase/functions/activate-installment-plan/index.ts`
  - `supabase/functions/stripe-webhook-test/index.ts`
  - `supabase/functions/stripe-webhook-live/index.ts`

```jsonc
// booking_app_checkout path
{ "plan_id": "uuid", "payment_record_id": "uuid", "trigger": "booking_app_checkout" }

// stripe_webhook path
{ "plan_id": "uuid", "trigger": "stripe_webhook_checkout_completed" }
```

---

#### `rental_cancelled` (checkout expired)
A Stripe checkout session expired before the customer completed payment.

- **Actor:** NULL (Stripe webhook)
- **Logged in:**
  - `supabase/functions/stripe-webhook-test/index.ts`
  - `supabase/functions/stripe-webhook-live/index.ts`

```jsonc
{ "trigger": "checkout_session_expired" }
```

---

#### `rental_updated` (agreement signed)
A BoldSign document was signed/completed.

- **Actor:** NULL (BoldSign webhook)
- **Logged in:** `supabase/functions/boldsign-webhook/index.ts`

```jsonc
{
  "trigger": "agreement_signed",
  "document_status": "completed",
  "activated": true
}
```

---

### E-Sign / Agreement Category — Added 2026-03-19

#### `agreement_sent`
An agreement was successfully created and sent to BoldSign for signing.

- **Actor:** NULL (system — triggered during checkout or by staff via portal)
- **Logged in:**
  - `apps/portal/src/app/api/esign/route.ts`
  - `apps/booking/src/app/api/esign/route.ts`

```jsonc
{
  "agreement_type": "original",     // or "extension"
  "boldsign_mode": "test",          // or "live"
  "document_id": "boldsign-doc-id"
}
```

---

#### `agreement_credit_failed`
Agreement could not be sent because the tenant had insufficient e-sign credits.

- **Actor:** NULL (system)
- **Logged in:**
  - `apps/portal/src/app/api/esign/route.ts`
  - `apps/booking/src/app/api/esign/route.ts`

```jsonc
{ "agreement_type": "original" }
```

---

#### `agreement_status_updated`
BoldSign webhook reports a status change on a rental agreement. Covers both original and extension agreements, and all status transitions (sent→viewed→signed→completed→declined).

- **Actor:** NULL (BoldSign webhook)
- **Logged in:** `supabase/functions/boldsign-webhook/index.ts`

```jsonc
{
  "agreement_type": "extension",
  "document_status": "completed",
  "agreement_id": "uuid"
}
```

> **No duplication with `rental_updated`:** The existing `rental_updated` log (trigger: `agreement_signed`) fires only for original agreements and specifically covers the rental status change to Active. `agreement_status_updated` covers the agreement lifecycle for ALL types.

---

#### `esign_mode_changed`
Staff toggles the BoldSign e-signature mode between test and live.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/settings/esign-settings.tsx`

```jsonc
{ "previous_mode": "test", "new_mode": "live" }
```

---

#### `settings_updated` (agreement template)
Staff creates, updates, deletes, or changes the active agreement template.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-agreement-templates.ts`

```jsonc
{ "setting": "agreement_template", "action": "created", "template_id": "uuid" }
{ "setting": "agreement_template", "action": "updated", "template_id": "uuid" }
{ "setting": "agreement_template", "action": "deleted", "template_id": "uuid" }
{ "setting": "agreement_template", "action": "set_active", "template_id": "uuid" }
{ "setting": "agreement_template", "action": "content_updated", "type": "custom" }
{ "setting": "agreement_template", "action": "reset_default" }
{ "setting": "agreement_template", "action": "cleared_custom" }
```

---

### Insurance Category — Added 2026-03-19

#### `insurance_policy_created`
Staff manually creates an insurance policy record for a customer.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/insurance/insurance-policy-dialog.tsx`

```jsonc
{ "policy_id": "uuid", "provider": "Aviva", "policy_number": "POL-123", "status": "Active" }
```

---

#### `insurance_policy_updated`
Staff updates an existing manual insurance policy.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/insurance/insurance-policy-dialog.tsx`

```jsonc
{ "policy_id": "uuid", "provider": "AXA", "policy_number": "POL-456", "status": "Active" }
```

---

#### `insurance_document_uploaded`
Staff uploads a supporting document for an insurance policy.

- **Actor:** portal staff
- **Logged in:**
  - `apps/portal/src/components/insurance/insurance-document-upload.tsx`
  - `apps/portal/src/components/insurance/document-upload-dialog.tsx`

```jsonc
{ "policy_id": "uuid", "doc_type": "Certificate", "file_name": "cert.pdf" }
// or with file_count for batch uploads
{ "policy_id": "uuid", "doc_type": "Certificate", "file_count": 3 }
```

---

#### `insurance_document_deleted`
Staff deletes a document from an insurance policy.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/insurance/insurance-document-upload.tsx`

```jsonc
{ "policy_id": "uuid" }
```

---

#### `bonzah_connected`
Staff verifies and connects Bonzah insurance credentials for the tenant.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/settings/bonzah-settings.tsx`

```jsonc
{ "bonzah_mode": "live" }
```

---

#### `bonzah_disconnected`
Staff disconnects Bonzah insurance credentials.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/settings/bonzah-settings.tsx`

```jsonc
// no additional details
```

---

#### `bonzah_alert_config_updated`
Staff updates the low balance alert configuration for Bonzah.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/settings/bonzah-settings.tsx`

```jsonc
{ "enabled": true, "threshold": 500 }
```

---

#### `insurance_retry_purchase`
Staff retries issuing a Bonzah insurance policy from the rental detail page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/InsuranceTimeline.tsx`

```jsonc
{ "policy_record_id": "uuid", "result": "success", "policy_no": "BNZ-12345" }
```

---

#### `insurance_policy_refreshed`
Staff refreshes policy data from Bonzah on the rental detail page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/InsuranceTimeline.tsx`

```jsonc
{ "policy_id": "bonzah-policy-id", "policy_record_id": "uuid" }
```

---

#### `insurance_purchased` (rental creation)
Insurance was purchased as part of creating a new rental from the portal.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/rentals/new/page.tsx`

```jsonc
{ "premium": 49.99, "policy_record_id": "uuid", "source": "rental_creation" }
```

> **No duplication with `buy-insurance-dialog`:** That dialog logs the same action for post-creation purchases from the rental detail page. This covers the rental creation flow — different code path, same logical action.

---

#### `document_uploaded` (customer insurance reupload)
Customer re-uploads their insurance document from the booking portal.

- **Actor:** NULL (customer action)
- **Logged in:** `apps/booking/src/components/customer-portal/EditInsuranceDialog.tsx`

```jsonc
{ "document_type": "insurance", "trigger": "customer_reupload", "file_count": 1, "rental_id": "uuid" }
```

---

#### `insurance_policy_expired`
System automatically marks an insurance policy as expired when its expiry date has passed.

- **Actor:** NULL (system/cron)
- **Logged in:** `supabase/functions/generate-insurance-reminders/index.ts`

```jsonc
{ "policy_number": "POL-123", "customer_id": "uuid", "expiry_date": "2026-03-15", "system_initiated": true }
```

---

#### `insurance_quote_created`
System creates a Bonzah insurance quote (one or more 30-day policies) for a rental. Fires for both booking checkout and portal-initiated purchases.

- **Actor:** NULL (system — called by checkout or portal)
- **Logged in:** `supabase/functions/bonzah-create-quote/index.ts`

```jsonc
{
  "customer_id": "uuid",
  "total_premium": 53.90,
  "policy_count": 2,
  "policy_type": "original",
  "coverage": { "cdw": true, "rcli": true, "sli": false, "pai": false }
}
```

> **Complementary to `insurance_purchased`:** Portal `buy-insurance-dialog` logs `insurance_purchased` (staff action with actor_id). This logs the system-level quote creation (no actor_id). Different actions, different actors.

---

#### `insurance_payment_confirmed`
Bonzah payment succeeded and one or more policies were activated.

- **Actor:** NULL (system)
- **Logged in:** `supabase/functions/bonzah-confirm-payment/index.ts`

```jsonc
{ "policy_no": "BNZ-12345", "status": "active", "chain_confirmed": 2 }
```

---

#### `insurance_payment_insufficient_balance`
Bonzah payment failed because the tenant's allocated balance was too low.

- **Actor:** NULL (system)
- **Logged in:** `supabase/functions/bonzah-confirm-payment/index.ts`

```jsonc
{ "balance": 100.00, "total_premium": 250.00 }
```

---

#### `insurance_payment_failed`
Bonzah payment failed for a non-balance reason.

- **Actor:** NULL (system)
- **Logged in:** `supabase/functions/bonzah-confirm-payment/index.ts`

```jsonc
{ "error": "Bonzah payment returned status 1" }
```

---

#### `insurance_document_scanned`
AI scan of a customer-uploaded insurance document completed.

- **Actor:** NULL (system)
- **Logged in:** `supabase/functions/scan-insurance-document/index.ts`

```jsonc
{ "verification_decision": "auto_approved", "validation_score": 0.92, "confidence_score": 0.85 }
```

---

### Customer Category — Added 2026-03-19

#### `customer_updated` (inline name edit)
Staff edits the customer name directly on the customer detail page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/customers/[id]/page.tsx`

```jsonc
{ "field": "name", "new_value": "John Smith" }
```

---

#### `customer_updated` (inline DOB edit)
Staff edits the customer date of birth directly on the customer detail page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/customers/[id]/page.tsx`

```jsonc
{ "field": "date_of_birth", "new_value": "1990-05-15" }
```

---

#### `verification_session_created` (AI provider — portal)
Staff creates an AI verification session for a customer from the portal.

- **Actor:** portal staff
- **Logged in:**
  - `apps/portal/src/components/customers/start-verification-dialog.tsx`
  - `apps/portal/src/components/customers/identity-verification-tab.tsx`
  - `apps/portal/src/app/(dashboard)/rentals/new/page.tsx`
  - `apps/portal/src/components/customers/customer-form-modal.tsx`

```jsonc
{ "provider": "ai" }
```

---

#### `document_uploaded` (gig driver image)
Staff uploads a gig driver proof image for a customer.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-gig-driver-images.ts`

```jsonc
{ "document_type": "gig_driver_image", "file_name": "uber-screenshot.jpg" }
```

---

#### `document_deleted` (gig driver image)
Staff deletes a gig driver proof image.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-gig-driver-images.ts`

```jsonc
{ "document_type": "gig_driver_image", "file_name": "uber-screenshot.jpg" }
```

---

#### `settings_updated` (credit wallet auto-refill)
Staff updates the credit wallet auto-refill configuration.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-credit-wallet.ts`

```jsonc
{ "setting": "credit_wallet_auto_refill", "enabled": true, "threshold": 10, "amount": 50 }
```

---

#### `customer_created` (self-signup)
A customer creates their own account via the booking app signup flow. No staff actor.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/customer-signup/index.ts`

```jsonc
{ "trigger": "self_signup", "email": "john@example.com" }
```

---

#### `customer_created` (invite registration)
A customer registers via an invite link generated by portal staff. No staff actor — the invite creation itself is logged separately as `customer_invite_created`.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/submit-customer-registration/index.ts`

```jsonc
{ "trigger": "invite_registration", "invite_id": "uuid", "email": "john@example.com" }
```

---

#### `customer_updated` (payment method)
A customer updates their payment method from the booking app. No staff actor.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/update-payment-method/index.ts`

```jsonc
{
  "field": "payment_method",
  "card_brand": "visa",
  "card_last4": "4242",
  "installment_plan_id": "uuid"   // null if updating default method
}
```

---

### Verification Category — Added 2026-03-19

#### `verification_completed` (Veriff provider)
Veriff webhook delivers a verification decision (approved/declined/resubmission). Consolidates: verification record update, customer status change, and auto-block if blocked identity detected.

- **Actor:** NULL (Veriff webhook)
- **Logged in:** `supabase/functions/veriff-webhook/index.ts`

```jsonc
{
  "provider": "veriff",
  "session_id": "veriff-session-uuid",
  "result": "GREEN",              // GREEN, RED, or RETRY
  "auto_blocked": false,          // true if blocked identity detected
  "document_number": "DL12345"    // null if not extracted
}
```

---

#### `verification_completed` (AI provider)
AI verification pipeline finishes processing (OCR + face match). Consolidates: verification record finalized, customer status/data updated, and auto-block if blocked identity detected. Also logged for early failures (OCR failed, face match failed) with `failure_reason` in details.

- **Actor:** NULL (customer-initiated via QR scan)
- **Logged in:** `supabase/functions/process-ai-verification/index.ts`

```jsonc
// Successful processing
{
  "provider": "ai",
  "session_id": "ai-session-uuid",
  "result": "verified",           // verified, rejected, or review_required
  "face_match_score": 92,         // 0-100 similarity score
  "auto_blocked": false,          // true if blocked identity detected
  "document_number": "DL12345"    // null if OCR failed
}

// Early failure (OCR or face match)
{
  "provider": "ai",
  "session_id": "ai-session-uuid",
  "result": "rejected",
  "failure_reason": "ocr_failed"  // or "face_match_failed"
}
```

---

### Customer Blocking & Status — Added 2026-03-19

#### `customer_blocked` (direct update from customers list)
Staff blocks a customer from the customers list page using the direct update path (not the RPC path).

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/customers/page.tsx`

```jsonc
{ "reason": "Fraudulent activity", "identity_type": "license", "identity_number": "DL12345" }
```

---

#### `customer_blocked` (auto-block during Veriff verification)
A blocked identity is detected during Veriff webhook processing and the customer is automatically blocked.

- **Actor:** NULL (Veriff webhook)
- **Logged in:** `supabase/functions/veriff-webhook/index.ts`

```jsonc
{ "trigger": "veriff_blocked_identity", "document_number": "DL12345", "reason": "Fraudulent activity" }
```

---

#### `customer_blocked` (auto-block during AI verification)
A blocked identity is detected during AI verification processing and the customer is automatically blocked.

- **Actor:** NULL (customer-initiated via QR scan)
- **Logged in:** `supabase/functions/process-ai-verification/index.ts`

```jsonc
{ "trigger": "ai_blocked_identity", "document_number": "DL12345", "reason": "Fraudulent activity" }
```

---

#### `customer_blocked` (auto-block during invite registration)
A newly registered customer is automatically blocked because their identity document matches a blocked identity. No staff actor — triggered during self-registration.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/submit-customer-registration/index.ts`

```jsonc
{ "trigger": "invite_registration_auto_block", "document_number": "DL12345" }
```

---

#### `customer_updated` (verification status pending — Veriff)
Customer's `identity_verification_status` set to `pending` when a Veriff session is created. Covers both portal-initiated and booking-flow calls.

- **Actor:** NULL (edge function)
- **Logged in:** `supabase/functions/create-veriff-session/index.ts`

```jsonc
{ "field": "identity_verification_status", "new_value": "pending", "trigger": "veriff_session_created" }
```

---

#### `customer_updated` (verification status pending — AI)
Same as above but for AI verification sessions.

- **Actor:** NULL (edge function)
- **Logged in:** `supabase/functions/create-ai-verification-session/index.ts`

```jsonc
{ "field": "identity_verification_status", "new_value": "pending", "trigger": "ai_session_created" }
```

---

#### `customer_updated` (stripe_customer_id — upfront checkout)
Stripe customer ID created and saved during upfront installment checkout flow.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/create-upfront-checkout/index.ts`

```jsonc
{ "field": "stripe_customer_id", "trigger": "upfront_checkout" }
```

---

#### `customer_updated` (stripe_customer_id — installment checkout)
Same as above but during full installment checkout flow.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/create-installment-checkout/index.ts`

```jsonc
{ "field": "stripe_customer_id", "trigger": "installment_checkout" }
```

---

### Cascading Blocks — Added 2026-03-19

#### `customer_blocked` (cascading from identity blocklist)
When a staff member adds an identity to the blocklist, ALL matching customers (by license/id_card/email) are automatically blocked. Each affected customer gets its own audit log entry.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-customer-blocking.ts` (`addBlockedIdentity`)

```jsonc
{
  "reason": "Fraudulent activity",
  "blocked_via": "identity_blocklist",
  "identity_type": "license",
  "identity_number": "DL12345"
}
```

---

### Booking App (Customer Self-Service) — Added 2026-03-19

All booking-app actions are customer-initiated with `actor_id: null`. Every entry includes `trigger: "customer_self_service"` or `trigger: "booking_checkout"` to distinguish from staff actions.

#### `customer_updated` (profile self-service)
Customer updates their own profile via settings page.

- **Actor:** NULL (customer action)
- **Logged in:** `apps/booking/src/app/(customer-portal)/portal/settings/page.tsx`

```jsonc
// Profile fields
{ "trigger": "customer_self_service", "fields": ["name", "phone", "timezone", "address", "license_number", "license_state"] }

// Profile photo
{ "trigger": "customer_self_service", "field": "profile_photo_url" }

// Password change
{ "trigger": "customer_self_service", "field": "password" }

// Email change
{ "trigger": "customer_self_service", "field": "email" }
```

---

#### `verification_session_created` (customer self-service)
Customer initiates identity verification from the booking portal (Veriff or AI).

- **Actor:** NULL (customer action)
- **Logged in:** `apps/booking/src/app/(customer-portal)/portal/verification/page.tsx`

```jsonc
// Veriff
{ "provider": "veriff", "trigger": "customer_self_service", "session_id": "veriff-session-uuid" }

// AI
{ "provider": "ai", "trigger": "customer_self_service" }
```

> **Deduplication note (2026-03-19):** Previously this page also logged `customer_updated` with `identity_verification_status: verified` on Veriff FINISHED and AI completion. Those were removed because the edge functions (`veriff-webhook`, `process-ai-verification`) are the authoritative source and already log `verification_completed`.

---

#### `customer_updated` (checkout verification link)
During checkout, a pre-booking verification is linked to the newly created customer and the customer's `identity_verification_status` is set based on the verification result. Acts as a safety net when the webhook hasn't landed yet.

- **Actor:** NULL (customer action)
- **Logged in:** `apps/booking/src/components/BookingCheckoutStep.tsx`

```jsonc
{
  "field": "identity_verification_status",
  "new_value": "verified",
  "trigger": "checkout_verification_link",
  "verification_id": "uuid"
}
```

---

#### `verification_session_created` (booking widget)
Customer initiates identity verification from the booking widget (Veriff or AI). Only logged when the customer is authenticated (`customerId` exists). Anonymous verifications are picked up later by the `verification_completed` edge function log.

- **Actor:** NULL (customer action)
- **Logged in:** `apps/booking/src/components/MultiStepBookingWidget.tsx`

```jsonc
{ "provider": "veriff", "trigger": "booking_widget", "session_id": "uuid" }
// or
{ "provider": "ai", "trigger": "booking_widget" }
```

---

#### `customer_updated` (invite registration verification link)
During invite registration, a pre-existing verification is linked to the newly created customer.

- **Actor:** NULL (customer action)
- **Logged in:** `supabase/functions/submit-customer-registration/index.ts`

```jsonc
{
  "field": "identity_verification_status",
  "trigger": "invite_registration_verification_link",
  "verification_session_id": "session-uuid"
}
```

---

#### `extension_requested` (customer self-service)
Customer requests a rental extension from the booking portal.

- **Actor:** NULL (customer action)
- **Logged in:** `apps/booking/src/components/customer-portal/ExtendRentalDialog.tsx`

```jsonc
{ "new_end_date": "2026-04-15", "extension_cost": 250 }
```

---

#### `customer_created` / `customer_updated` (booking checkout)
Customer record created or updated during the booking checkout flow.

- **Actor:** NULL (customer action)
- **Logged in:** `checkout/page.tsx`, `BookingCheckout.tsx`, `BookingCheckoutStep.tsx`

```jsonc
// New customer
{ "trigger": "booking_checkout", "email": "john@example.com" }

// Existing customer updated
{ "trigger": "booking_checkout", "fields": ["name", "phone", "status"] }

// Phone sync
{ "trigger": "booking_checkout", "field": "phone" }

// Gig driver flag
{ "trigger": "booking_checkout", "field": "is_gig_driver", "new_value": true, "gig_images_count": 2 }
```

---

#### `document_uploaded` / `document_deleted` (customer self-service)
Customer uploads or deletes documents (insurance, gig driver images) from the booking portal.

- **Actor:** NULL (customer action)
- **Logged in:** `portal/gig-driver/page.tsx`, `DocumentUploadDialog.tsx`, `use-customer-documents.ts`, checkout files

```jsonc
// Gig driver image
{ "document_type": "gig_driver_image", "trigger": "customer_self_service", "count": 2 }

// Insurance doc
{ "document_type": "insurance", "trigger": "customer_self_service", "count": 1 }

// Delete
{ "trigger": "customer_self_service" }
```

---

#### `agreement_sign_initiated` / `agreement_viewed` / `agreement_downloaded` (customer self-service)
Customer interacts with their rental agreements from the booking portal. These are **distinct** from `agreement_status_updated` (logged by `boldsign-webhook`) which tracks actual signing completion.

- **Actor:** NULL (customer action)
- **Entity type:** `rental_agreement`
- **Logged in:** `apps/booking/src/app/(customer-portal)/portal/agreements/page.tsx`

```jsonc
// Sign initiated (customer opened signing page — does NOT mean signing completed)
{ "rental_id": "uuid", "rental_number": "R-123", "agreement_type": "original", "document_id": "boldsign-doc-id", "method": "embedded" }

// Viewed
{ "rental_id": "uuid", "rental_number": "R-123", "agreement_type": "original" }

// Downloaded
{ "rental_id": "uuid", "rental_number": "R-123", "agreement_type": "extension" }
```

> **Deduplication note:** `agreement_sign_initiated` captures customer intent (opened signing page). The actual signing completion is tracked by `boldsign-webhook` → `agreement_status_updated`. These are two distinct events.

---

#### `installment_early_payment_initiated` / `installment_payoff_initiated` / `payment_retry_initiated` (customer self-service)
Customer initiates payment actions from the booking portal payments tab. These are **distinct** from `installment_paid_early` / `installment_payment_processed` (logged by edge functions) which track the actual payment result.

- **Actor:** NULL (customer action)
- **Entity type:** `payment`
- **Logged in:** `apps/booking/src/hooks/use-payment-actions.ts`

```jsonc
// Pay single installment early
{ "trigger": "customer_portal", "amount": 150 }

// Pay off all remaining installments
{ "trigger": "customer_portal", "amount": 450 }

// Retry failed payment
{ "trigger": "customer_portal", "amount": 150 }
```

> **Deduplication note:** These log customer *intent*. The edge function `pay-installment-early` separately logs `installment_paid_early` for the payment *result*. Different action names prevent confusion.

---

#### `payment_method_updated` (customer self-service)
Customer updates their payment method from the booking portal.

- **Actor:** NULL (customer action)
- **Entity type:** `customer`
- **Logged in:** `apps/booking/src/hooks/use-payment-actions.ts`

```jsonc
{ "trigger": "customer_portal", "installment_plan_id": "uuid" }
```

> **Deduplication note:** The edge function `update-payment-method` separately logs `customer_updated` with card details. This client-side log captures the customer's intent; the edge function log captures the confirmed result.

---

#### `message_sent` (customer self-service)
Customer sends a chat message from the booking portal. Message content is NOT logged for privacy.

- **Actor:** NULL (customer action)
- **Entity type:** `chat_message`
- **Logged in:** `apps/booking/src/components/customer-portal/chat/CustomerChatInput.tsx`

```jsonc
{ "trigger": "customer_portal", "has_booking_reference": true }
```

---

## Querying Audit Logs

Always filter by `tenant_id`. Get your tenant ID from the slug:

```sql
-- All payment-related audit entries for a tenant
SELECT
  action,
  entity_type,
  entity_id,
  actor_id IS NOT NULL AS has_actor,
  details,
  created_at
FROM audit_logs
WHERE action IN (
  'payment_created',
  'payment_refunded',
  'payment_captured',
  'payment_reversed',
  'deposit_deducted',
  'fine_authority_payment',
  'installment_paid_early',
  'installment_payment_processed',
  'installment_payments_refunded',
  'credit_wallet_purchased'
)
AND tenant_id = (SELECT id FROM tenants WHERE slug = 'your-slug')
ORDER BY created_at DESC
LIMIT 50;
```

```sql
-- System/cron entries only (no staff actor)
SELECT action, details, created_at
FROM audit_logs
WHERE actor_id IS NULL
AND tenant_id = (SELECT id FROM tenants WHERE slug = 'your-slug')
ORDER BY created_at DESC
LIMIT 20;
```

```sql
-- Activity by a specific staff member
SELECT action, entity_type, entity_id, details, created_at
FROM audit_logs
WHERE actor_id = (
  SELECT id FROM app_users WHERE email = 'staff@example.com'
)
AND tenant_id = (SELECT id FROM tenants WHERE slug = 'your-slug')
ORDER BY created_at DESC
LIMIT 50;
```

---

## Coverage Status

### Payment Category

| Edge Function | Portal Call Site | Audit Coverage |
|---|---|---|
| `apply-payment` | `add-payment-dialog.tsx` | ✅ `payment_created` |
| `apply-payment` | `use-payment-verification.ts` | ✅ `payment_captured` |
| `apply-payment` | `rentals/[id]/page.tsx` (webhook fallback) | ✅ `payment_captured` |
| `capture-booking-payment` | `use-booking-approval.ts` | ✅ `payment_captured` |
| `process-refund` | `refund-dialog.tsx` | ✅ `payment_refunded` |
| `process-refund` | `use-key-handover.ts` | ✅ `payment_refunded` |
| `record-authority-payment` | `authority-payment-dialog.tsx` | ✅ `fine_authority_payment` |
| `reverse-payment` | `payments/page.tsx` | ✅ `payment_reversed` |
| `deduct-from-deposit` | `rentals/[id]/page.tsx` | ✅ `deposit_deducted` |
| `deduct-from-deposit` | `use-key-handover.ts` | ✅ `deposit_deducted` |
| `pay-installment-early` | _(booking app — no portal call site)_ | ✅ `installment_paid_early` |
| `process-installment-payment` | _(cron — no portal call site)_ | ✅ `installment_payment_processed` |
| `refund-installment-payments` | `rejection-dialog.tsx` | ✅ `installment_payments_refunded` |
| `create-checkout-session` | `add-payment-dialog.tsx` (Stripe checkout flow) | ✅ `payment_created` (method: stripe_checkout) |
| `create-extension-checkout` | `ExtensionRequestDialog.tsx` | ✅ `payment_created` (method: stripe_checkout_extension) |
| `create-extension-checkout` | `AdminExtendRentalDialog.tsx` | ✅ `payment_created` (method: stripe_checkout_extension) |
| `create-credit-checkout` | `use-credit-wallet.ts` | ✅ `credit_wallet_purchased` |

### Not in scope (booking app / no app_user actor)
| Call Site | Reason |
|---|---|
| `booking/booking-success/page.tsx` — `apply-payment` | Customer-initiated Stripe return, no staff actor |
| `booking/BookingSuccess.tsx` — `apply-payment` | Same as above |
| `DevPanel.tsx` — `apply-payment` | Development tool only |

### Rental Category

| Call Site | Audit Coverage |
|---|---|
| `rentals/[id]/page.tsx` — `syncStatusToActive` | ✅ `rental_updated` (status_sync) |
| `rentals/[id]/page.tsx` — renewal auto-close | ✅ `rental_closed` (renewed_by) |
| `rentals/[id]/page.tsx` — Approve dialog (manual capture) | ✅ `payment_captured` (manual_capture) |
| `rentals/[id]/page.tsx` — Approve dialog | ✅ `rental_approved` |
| `rentals/[id]/page.tsx` — inline Close dialog | ✅ `rental_closed` (inline_close) |
| `rentals/[id]/page.tsx` — inline Delete dialog | ✅ `rental_deleted` |
| `rentals/[id]/page.tsx` — `approveInsuranceMutation` | ✅ `document_updated` (insurance_approved) |
| `rentals/[id]/page.tsx` — `linkDocumentMutation` | ✅ `document_updated` (insurance_linked) |
| `rentals/[id]/page.tsx` — `retryScanMutation` | ✅ `document_updated` (ai_scan_retried) |
| `rentals/[id]/page.tsx` — `deleteDocumentMutation` | ✅ `document_deleted` (insurance_deleted) |
| `use-payment-verification.ts` — `rejectPayment` | ✅ `payment_failed` |
| `use-key-handover.ts` — `markKeyHanded("giving")` | ✅ `rental_started` |
| `use-key-handover.ts` — `markKeyHanded("receiving")` | ✅ `rental_closed` (key_handover) |
| `use-key-handover.ts` — `unmarkKeyHanded` | ✅ `rental_updated` (undo_key_handover) |
| `use-key-handover.ts` — `updateMileage("receiving")` | ✅ `rental_updated` (mileage_updated) |
| `use-key-handover.ts` — `uploadPhoto` | ✅ `document_uploaded` |
| `use-key-handover.ts` — `deletePhoto` | ✅ `document_deleted` |
| `use-rental-review.ts` — `useSubmitRentalReview` | ✅ `rental_review_submitted` |
| `use-rental-review.ts` — `useSkipRentalReview` | ✅ `rental_review_skipped` |
| `buy-insurance-dialog.tsx` | ✅ `insurance_purchased` |
| `insurance-policy-dialog.tsx` — create | ✅ `insurance_policy_created` |
| `insurance-policy-dialog.tsx` — update | ✅ `insurance_policy_updated` |
| `insurance-document-upload.tsx` — upload | ✅ `insurance_document_uploaded` |
| `insurance-document-upload.tsx` — delete | ✅ `insurance_document_deleted` |
| `document-upload-dialog.tsx` — upload | ✅ `insurance_document_uploaded` |
| `InsuranceTimeline.tsx` — retry purchase | ✅ `insurance_retry_purchase` |
| `InsuranceTimeline.tsx` — refresh policy | ✅ `insurance_policy_refreshed` |
| `rentals/new/page.tsx` — insurance at creation | ✅ `insurance_purchased` (rental_creation) |
| `bonzah-settings.tsx` — connect | ✅ `bonzah_connected` |
| `bonzah-settings.tsx` — disconnect | ✅ `bonzah_disconnected` |
| `bonzah-settings.tsx` — alert config | ✅ `bonzah_alert_config_updated` |
| `bonzah-create-quote/index.ts` — quote created | ✅ `insurance_quote_created` |
| `bonzah-confirm-payment/index.ts` — success | ✅ `insurance_payment_confirmed` |
| `bonzah-confirm-payment/index.ts` — insufficient balance | ✅ `insurance_payment_insufficient_balance` |
| `bonzah-confirm-payment/index.ts` — failure | ✅ `insurance_payment_failed` |
| `generate-insurance-reminders/index.ts` — policy expired | ✅ `insurance_policy_expired` |
| `scan-insurance-document/index.ts` — scan completed | ✅ `insurance_document_scanned` |
| `activate-installment-plan/index.ts` | ✅ `installment_plan_activated` (booking_app_checkout) |
| `stripe-webhook-test/index.ts` — installment checkout | ✅ `installment_plan_activated` (stripe_webhook) |
| `stripe-webhook-live/index.ts` — installment checkout | ✅ `installment_plan_activated` (stripe_webhook) |
| `stripe-webhook-test/index.ts` — checkout expired | ✅ `rental_cancelled` (checkout_session_expired) |
| `stripe-webhook-live/index.ts` — checkout expired | ✅ `rental_cancelled` (checkout_session_expired) |
| `boldsign-webhook/index.ts` — agreement signed | ✅ `rental_updated` (agreement_signed) |
| `boldsign-webhook/index.ts` — agreement status change | ✅ `agreement_status_updated` (all types) |
| `/api/esign` (portal) — agreement sent | ✅ `agreement_sent` |
| `/api/esign` (portal) — credit failed | ✅ `agreement_credit_failed` |
| `/api/esign` (booking) — agreement sent | ✅ `agreement_sent` |
| `/api/esign` (booking) — credit failed | ✅ `agreement_credit_failed` |
| `use-agreement-templates.ts` — CRUD | ✅ `settings_updated` (agreement_template) |
| `esign-settings.tsx` — mode toggle | ✅ `esign_mode_changed` |
| `use-installment-plan.ts` — `retryPaymentMutation` | ✅ `installment_payment_retried` |
| `use-installment-plan.ts` — `cancelPlanMutation` | ✅ `installment_plan_cancelled` |
| `use-installment-plan.ts` — `markPaidMutation` | ✅ `installment_marked_paid` |
| `fines/[id]/page.tsx` — `waiveFineAction` | ✅ `fine_waived` |
| `bulk-action-bar.tsx` — `bulkChargeMutation` | ✅ `fine_bulk_charged` |
| `bulk-action-bar.tsx` — `bulkWaiveMutation` | ✅ `fine_bulk_waived` |
| `start-verification-dialog.tsx` — Veriff path | ✅ `verification_session_created` |
| `start-verification-dialog.tsx` — AI path | ✅ `verification_session_created` |
| `identity-verification-tab.tsx` — Veriff path | ✅ `verification_session_created` |
| `identity-verification-tab.tsx` — AI path | ✅ `verification_session_created` |
| `rentals/new/page.tsx` — Veriff path | ✅ `verification_session_created` |
| `rentals/new/page.tsx` — AI path | ✅ `verification_session_created` |
| `customer-form-modal.tsx` — AI verification | ✅ `verification_session_created` |
| `rentals/[id]/page.tsx` — auto-link verification | ✅ `customer_updated` (auto_link_verification) |
| `generate-invite-dialog.tsx` — `handleGenerate` | ✅ `customer_invite_created` |
| `use-rental-extras.ts` — `createExtraMutation` | ✅ `extra_created` |
| `use-rental-extras.ts` — `updateExtraMutation` | ✅ `extra_updated` |
| `use-rental-extras.ts` — `deleteExtraMutation` | ✅ `extra_deleted` |
| `use-rental-settings.ts` — `updateSettingsMutation` | ✅ `settings_updated` (rental_settings) |
| `customers/[id]/page.tsx` — inline name edit | ✅ `customer_updated` (name) |
| `customers/[id]/page.tsx` — inline DOB edit | ✅ `customer_updated` (date_of_birth) |
| `use-gig-driver-images.ts` — `useUploadGigDriverImage` | ✅ `document_uploaded` (gig_driver_image) |
| `use-gig-driver-images.ts` — `useDeleteGigDriverImage` | ✅ `document_deleted` (gig_driver_image) |
| `use-credit-wallet.ts` — `updateAutoRefill` | ✅ `settings_updated` (credit_wallet_auto_refill) |
| `customer-signup/index.ts` — self-signup | ✅ `customer_created` (self_signup) |
| `submit-customer-registration/index.ts` — invite registration | ✅ `customer_created` (invite_registration) |
| `update-payment-method/index.ts` — confirm action | ✅ `customer_updated` (payment_method) |
| `veriff-webhook/index.ts` — decision event | ✅ `verification_completed` (veriff) |
| `process-ai-verification/index.ts` — processing complete | ✅ `verification_completed` (ai) |
| `process-ai-verification/index.ts` — OCR failure | ✅ `verification_completed` (ai, ocr_failed) |
| `process-ai-verification/index.ts` — face match failure | ✅ `verification_completed` (ai, face_match_failed) |
| `process-ai-verification/index.ts` — auto-block | ✅ `customer_blocked` (ai_blocked_identity) |
| `veriff-webhook/index.ts` — auto-block | ✅ `customer_blocked` (veriff_blocked_identity) |
| `customers/page.tsx` — `handleBlockCustomer` direct update | ✅ `customer_blocked` |
| `submit-customer-registration/index.ts` — auto-block on blocked identity | ✅ `customer_blocked` (invite_registration_auto_block) |
| `submit-customer-registration/index.ts` — verification linked to customer | ✅ `customer_updated` (invite_registration_verification_link) |
| `create-veriff-session/index.ts` — status set to pending | ✅ `customer_updated` (veriff_session_created) |
| `create-ai-verification-session/index.ts` — status set to pending | ✅ `customer_updated` (ai_session_created) |
| `create-upfront-checkout/index.ts` — stripe_customer_id set | ✅ `customer_updated` (upfront_checkout) |
| `create-installment-checkout/index.ts` — stripe_customer_id set | ✅ `customer_updated` (installment_checkout) |
| `use-customer-blocking.ts` — cascading customer blocks (license/id_card) | ✅ `customer_blocked` (identity_blocklist) |
| `use-customer-blocking.ts` — cascading customer blocks (email) | ✅ `customer_blocked` (identity_blocklist) |
| **Booking App — Customer Portal** | |
| `portal/settings/page.tsx` — profile update | ✅ `customer_updated` (customer_self_service) |
| `portal/settings/page.tsx` — profile photo | ✅ `customer_updated` (customer_self_service) |
| `portal/settings/page.tsx` — password change | ✅ `customer_updated` (customer_self_service) |
| `portal/settings/page.tsx` — email change | ✅ `customer_updated` (customer_self_service) |
| `portal/gig-driver/page.tsx` — image upload | ✅ `document_uploaded` (customer_self_service) |
| `portal/gig-driver/page.tsx` — image delete | ✅ `document_deleted` (customer_self_service) |
| `portal/verification/page.tsx` — Veriff session created | ✅ `verification_session_created` (customer_self_service) |
| `portal/verification/page.tsx` — AI session created | ✅ `verification_session_created` (customer_self_service) |
| `portal/verification/page.tsx` — details edited | ✅ `customer_updated` (customer_self_service) |
| `DocumentUploadDialog.tsx` — insurance upload | ✅ `document_uploaded` (customer_self_service) |
| `EditInsuranceDialog.tsx` — insurance reupload | ✅ `document_uploaded` (customer_reupload) |
| `use-customer-documents.ts` (booking) — delete | ✅ `document_deleted` (customer_self_service) |
| **Booking App — Checkout Flows** | |
| `checkout/page.tsx` — customer created | ✅ `customer_created` (booking_checkout) |
| `checkout/page.tsx` — insurance docs linked | ✅ `document_uploaded` (booking_checkout) |
| `checkout/page.tsx` — gig driver flag + images | ✅ `customer_updated` (booking_checkout) |
| `BookingCheckout.tsx` — phone sync | ✅ `customer_updated` (booking_checkout) |
| `BookingCheckout.tsx` — customer created | ✅ `customer_created` (booking_checkout) |
| `BookingCheckout.tsx` — insurance docs linked | ✅ `document_uploaded` (booking_checkout) |
| `MultiStepBookingWidget.tsx` — phone auto-save | ✅ `customer_updated` (booking_widget_auto_save) |
| `MultiStepBookingWidget.tsx` — Veriff session created | ✅ `verification_session_created` (booking_widget, when authenticated) |
| `MultiStepBookingWidget.tsx` — AI session created | ✅ `verification_session_created` (booking_widget, when authenticated) |
| `BookingCheckoutStep.tsx` — customer created/updated | ✅ `customer_created`/`customer_updated` (booking_checkout) |
| `BookingCheckoutStep.tsx` — verification linking + status | ✅ `customer_updated` (checkout_verification_link) |
| `BookingCheckoutStep.tsx` — gig driver | ✅ `customer_updated` (booking_checkout) |
| `ExtendRentalDialog.tsx` (booking) — extension request | ✅ `extension_requested` (customer_self_service) |
| `BookingCheckoutStep.tsx` — insurance docs | ✅ `document_uploaded` (booking_checkout) |

### Subscription Category — Added 2026-03-19

#### `subscription_plan_created`
Super admin creates a new subscription plan for a tenant.

- **Actor:** super admin (`app_users.id`)
- **Logged in:** `supabase/functions/manage-subscription-plans/index.ts`

```jsonc
{ "plan_name": "Pro", "amount": 4900, "currency": "usd", "interval": "month", "trial_days": 14 }
```

---

#### `subscription_plan_updated`
Super admin updates an existing subscription plan.

- **Actor:** super admin
- **Logged in:** `supabase/functions/manage-subscription-plans/index.ts`

```jsonc
{ "changes": { "name": "Enterprise", "amount": 9900 }, "pricing_changed": true }
```

---

#### `subscription_plan_deactivated`
Super admin deactivates a subscription plan.

- **Actor:** super admin
- **Logged in:** `supabase/functions/manage-subscription-plans/index.ts`

```jsonc
{ "plan_name": "Pro" }
```

---

#### `subscription_plan_activated`
Super admin reactivates a deactivated subscription plan.

- **Actor:** super admin
- **Logged in:** `supabase/functions/manage-subscription-plans/index.ts`

```jsonc
{ "plan_name": "Pro" }
```

---

#### `subscription_plan_deleted`
Super admin deletes a subscription plan (only allowed if no subscriptions exist).

- **Actor:** super admin
- **Logged in:** `supabase/functions/manage-subscription-plans/index.ts`

```jsonc
{ "plan_name": "Pro" }
```

---

#### `subscription_checkout_created`
Portal staff initiates a subscription checkout for their tenant.

- **Actor:** portal staff (`app_users.id`)
- **Logged in:** `supabase/functions/create-subscription-checkout/index.ts`

```jsonc
{ "plan_name": "Pro", "amount": 4900, "currency": "usd", "trial_days": 14, "stripe_mode": "test", "checkout_session_id": "cs_xxx" }
```

---

#### `subscription_activated`
Stripe webhook confirms a new subscription after checkout completes.

- **Actor:** NULL (Stripe webhook)
- **Logged in:** `supabase/functions/subscription-webhook/index.ts`

```jsonc
{ "stripe_subscription_id": "sub_xxx", "plan_name": "Pro", "plan_id": "uuid", "status": "trialing", "is_trial": true }
```

---

#### `subscription_updated`
Stripe webhook reports a subscription status change (renewal, trial end, payment update, etc.).

- **Actor:** NULL (Stripe webhook)
- **Logged in:** `supabase/functions/subscription-webhook/index.ts`

```jsonc
{ "stripe_subscription_id": "sub_xxx", "status": "active", "plan_name": "Pro", "auto_go_live": true }
```

---

#### `subscription_cancelled`
Stripe webhook reports a subscription has been deleted/cancelled.

- **Actor:** NULL (Stripe webhook)
- **Logged in:** `supabase/functions/subscription-webhook/index.ts`

```jsonc
{ "stripe_subscription_id": "sub_xxx" }
```

---

#### `subscription_invoice_paid`
Stripe webhook confirms a subscription invoice was paid.

- **Actor:** NULL (Stripe webhook)
- **Logged in:** `supabase/functions/subscription-webhook/index.ts`

```jsonc
{ "stripe_invoice_id": "in_xxx", "amount_paid": 4900, "currency": "usd", "invoice_number": "INV-001" }
```

---

#### `subscription_invoice_failed`
Stripe webhook reports a subscription invoice payment failed.

- **Actor:** NULL (Stripe webhook)
- **Logged in:** `supabase/functions/subscription-webhook/index.ts`

```jsonc
{ "stripe_invoice_id": "in_xxx", "amount_due": 4900, "currency": "usd", "invoice_number": "INV-001" }
```

---

#### `subscription_stripe_mode_changed`
Admin toggles the subscription Stripe mode between test and live for a tenant.

- **Actor:** NULL (admin app — no app_users actor resolved)
- **Logged in:** `apps/admin/app/admin/(protected)/rentals/[id]/page.tsx`

```jsonc
{ "previous_mode": "test", "new_mode": "live" }
```

---

### Subscription Coverage Status

| Call Site | Audit Coverage |
|---|---|
| `manage-subscription-plans` — create | ✅ `subscription_plan_created` |
| `manage-subscription-plans` — update | ✅ `subscription_plan_updated` |
| `manage-subscription-plans` — deactivate | ✅ `subscription_plan_deactivated` |
| `manage-subscription-plans` — activate | ✅ `subscription_plan_activated` |
| `manage-subscription-plans` — delete | ✅ `subscription_plan_deleted` |
| `manage-subscription-plans` — list | Read-only, no audit |
| `create-subscription-checkout` | ✅ `subscription_checkout_created` |
| `subscription-webhook` — checkout.session.completed | ✅ `subscription_activated` |
| `subscription-webhook` — customer.subscription.updated | ✅ `subscription_updated` |
| `subscription-webhook` — customer.subscription.deleted | ✅ `subscription_cancelled` |
| `subscription-webhook` — invoice.paid | ✅ `subscription_invoice_paid` |
| `subscription-webhook` — invoice.payment_failed | ✅ `subscription_invoice_failed` |
| `subscription-webhook` — credit_purchase | Skipped (credit wallet, not subscription) |
| `admin/rentals/[id]` — subscription Stripe mode toggle | ✅ `subscription_stripe_mode_changed` |
| `get-subscription-details` | Read-only, no audit |
| `create-subscription-portal-session` | Read-only, no audit |
| `use-tenant-subscription.ts` (portal) | No logging — edge functions handle it |
| `use-subscription-plans.ts` (portal) | Read-only — fetches plans |

### Settings Category — Added 2026-03-20

All settings mutations use the existing `settings_updated` action with a `section` field in details to distinguish which setting was changed.

| Call Site | Section | Audit Coverage |
|---|---|---|
| `use-weekend-pricing.ts` — `updateSettings` | `weekend_pricing` | ✅ `settings_updated` |
| `use-lockbox-templates.ts` — `saveTemplate` | `lockbox_template` | ✅ `settings_updated` |
| `use-vehicle-pricing-overrides.ts` — upsert | `pricing_override` | ✅ `settings_updated` |
| `use-vehicle-pricing-overrides.ts` — delete | `pricing_override` (removed) | ✅ `settings_updated` |
| `use-vehicle-pricing-overrides.ts` — reset | `pricing_override` (reset) | ✅ `settings_updated` |
| `use-pickup-locations.ts` — `updateSettings` | `location_settings` | ✅ `settings_updated` |
| `settings/page.tsx` — reset to defaults | `general` (reset_to_defaults) | ✅ `settings_updated` |
| `settings/page.tsx` — combined save (general) | `general` | ✅ `settings_updated` |
| `settings/page.tsx` — combined save (branding) | `branding` | ✅ `settings_updated` |
| `bonzah-settings.tsx` — auto-enable test mode | `bonzah` (auto_test_mode) | ✅ `settings_updated` |

### User Management Category — Added 2026-03-20

All user management mutations are logged in their respective edge functions. The portal UI does NOT duplicate these logs — edge functions are the single source of truth.

#### `create_user`
Super admin creates a new staff user for a tenant.

- **Actor:** super admin (`app_users.id`)
- **Logged in:** `supabase/functions/admin-create-user/index.ts`

```jsonc
{ "email": "staff@example.com", "name": "John", "role": "admin" }
```

---

#### `update_role`
Super admin changes a staff user's role.

- **Actor:** super admin
- **Logged in:** `supabase/functions/admin-update-role/index.ts`

```jsonc
{ "old_role": "ops", "new_role": "admin", "target_email": "staff@example.com" }
```

---

#### `activate_user` / `deactivate_user`
Super admin activates or deactivates a staff user.

- **Actor:** super admin
- **Logged in:** `supabase/functions/admin-deactivate-user/index.ts`

```jsonc
{ "target_email": "staff@example.com", "previous_status": true, "new_status": false }
```

---

#### `reset_password`
Super admin resets a staff user's password.

- **Actor:** super admin
- **Logged in:** `supabase/functions/admin-reset-password/index.ts`

```jsonc
{ "target_email": "staff@example.com" }
```

---

#### `force_logout_global` / `force_logout_tenant`
Super admin forces logout of all users (globally or per-tenant).

- **Actor:** super admin
- **Logged in:** `supabase/functions/admin-force-logout/index.ts`

```jsonc
{ "target_tenant_id": "uuid", "total_users": 5, "success_count": 5, "fail_count": 0 }
```

---

#### `update_manager_permissions`
Super admin updates granular tab permissions for a manager-role user.

- **Actor:** super admin
- **Logged in:** `supabase/functions/update-manager-permissions/index.ts`

```jsonc
{ "target_email": "manager@example.com", "permissions": [{ "tab_key": "rentals", "access_level": "editor" }] }
```

---

#### `user_created` (super admin creation)
Primary super admin creates a new super admin account from the admin app.

- **Actor:** NULL (admin app — no actor resolution)
- **Logged in:** `apps/admin/app/admin/(protected)/admins/page.tsx`

```jsonc
{ "email": "admin@example.com", "name": "New Admin", "role": "super_admin", "is_super_admin": true }
```

---

### User Management Coverage Status

| Call Site | Audit Coverage |
|---|---|
| `admin-create-user` edge function | ✅ `create_user` |
| `admin-update-role` edge function | ✅ `update_role` |
| `admin-deactivate-user` edge function | ✅ `activate_user` / `deactivate_user` |
| `admin-reset-password` edge function | ✅ `reset_password` |
| `admin-force-logout` edge function | ✅ `force_logout_global` / `force_logout_tenant` |
| `update-manager-permissions` edge function | ✅ `update_manager_permissions` |
| `admin/admins/page.tsx` — super admin creation | ✅ `user_created` |
| `admin-delete-tenant` edge function | Skipped — deletes its own audit_logs |
| `emergency-bootstrap` edge function | Skipped — break-glass emergency tool |
| `portal/users/page.tsx` | No client-side logging — edge functions handle it |
| `portal/settings/users/page.tsx` | No client-side logging — edge functions handle it |

### Edge Functions Category — Added 2026-03-20

#### `payment_captured` (capture-booking-payment)
Pre-auth payment was captured via Stripe after booking approval.

- **Actor:** approvedBy (staff ID) or null
- **Logged in:** `supabase/functions/capture-booking-payment/index.ts`
- **Entity type:** `payment`
- **Details:** `{ rental_id, amount, stripe_payment_intent_id }`

#### `payment_applied` (apply-payment)
Payment was allocated to charges via the ledger system.

- **Actor:** system (actor_id: null)
- **Logged in:** `supabase/functions/apply-payment/index.ts`
- **Entity type:** `payment`
- **Details:** `{ allocated, remaining, status, rental_id }`

#### `payment_refunded` (process-refund)
A Stripe or manual refund was processed.

- **Actor:** system (actor_id: null)
- **Logged in:** `supabase/functions/process-refund/index.ts`
- **Entity type:** `payment`
- **Details:** `{ rental_id, category, refund_amount, reason, refund_type }`

#### `payment_refund_scheduled` (schedule-refund)
A refund was scheduled for future processing.

- **Actor:** scheduledBy (staff ID) or null
- **Logged in:** `supabase/functions/schedule-refund/index.ts`
- **Entity type:** `payment`
- **Details:** `{ refund_amount, scheduled_date, reason }`

#### `payment_reversed` (reverse-payment)
A manual payment was reversed, undoing all charge allocations.

- **Actor:** system (actor_id: null)
- **Logged in:** `supabase/functions/reverse-payment/index.ts`
- **Entity type:** `payment`
- **Details:** `{ amount, reason, applications_reversed }`

#### `stripe_account_created` (create-connected-account)
A Stripe Connect account was created for a tenant.

- **Actor:** system (actor_id: null)
- **Logged in:** `supabase/functions/create-connected-account/index.ts`
- **Entity type:** `settings`
- **Details:** `{ stripe_account_id }`

#### `stripe_account_synced` (sync-stripe-account)
Stripe Connect account status was synced to the tenant record.

- **Actor:** system (actor_id: null)
- **Logged in:** `supabase/functions/sync-stripe-account/index.ts`
- **Entity type:** `settings`
- **Details:** `{ stripe_account_id, status, onboarding_complete }`

#### `review_summary_generated` (generate-review-summary)
AI-generated customer review summary was created/updated.

- **Actor:** system (actor_id: null)
- **Logged in:** `supabase/functions/generate-review-summary/index.ts`
- **Entity type:** `customer`
- **Details:** `{ average_rating, total_reviews }`

### Booking App Category — Added 2026-03-20

#### `rental_created` (booking checkout)
A new rental was created during booking checkout.

- **Actor:** customer (actor_id: null)
- **Logged in:** `apps/booking/src/app/booking/checkout/page.tsx`
- **Entity type:** `rental`
- **Details:** `{ trigger: "booking_checkout", vehicle_id, start_date, end_date }`

#### `vehicle_status_changed` (booking checkout)
Vehicle status changed to "Rented" after successful rental creation.

- **Actor:** customer (actor_id: null)
- **Logged in:** `apps/booking/src/app/booking/checkout/page.tsx`
- **Entity type:** `vehicle`
- **Details:** `{ new_status: "Rented", trigger: "booking_checkout", rental_id }`

#### `rental_renewal_requested`
Customer submitted a renewal request from the customer portal.

- **Actor:** customer (actor_id: null)
- **Logged in:** `apps/booking/src/components/customer-portal/RenewRentalDialog.tsx`
- **Entity type:** `rental`
- **Details:** `{ new_start_date, new_end_date, vehicle_id }`

#### `rental_cancellation_requested`
Customer submitted a cancellation request from the customer portal.

- **Actor:** customer (actor_id: null)
- **Logged in:** `apps/booking/src/components/customer-portal/CancelBookingDialog.tsx`
- **Entity type:** `rental`
- **Details:** `{ reason }`

#### `rental_payment_fulfilled`
Rental payment status was set to "fulfilled" after successful Stripe checkout.

- **Actor:** customer (actor_id: null)
- **Logged in:** `apps/booking/src/app/booking-success/page.tsx`
- **Entity type:** `rental`
- **Details:** `{ session_id }`

### CMS / Website Content Category — Added 2026-03-20

#### `faq_updated` (reorder)
FAQ display order was changed via move up/down.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/website-content/faqs-manager.tsx`
- **Entity type:** `faq`
- **Details:** `{ field: "display_order", direction: "up" | "down" }`

#### `faq_updated` (toggle active)
FAQ active status was toggled on/off.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/website-content/faqs-manager.tsx`
- **Entity type:** `faq`
- **Details:** `{ field: "is_active", value }`

#### `promotion_created`
A new promotion was created.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/cms/promotions/page.tsx`
- **Entity type:** `promotion`
- **Details:** `{ title }`

#### `promotion_updated`
A promotion was edited or its active status was toggled.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/cms/promotions/page.tsx`
- **Entity type:** `promotion`
- **Details:** `{ title }` or `{ field: "is_active", value }`

#### `promotion_deleted`
A promotion was permanently deleted.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/cms/promotions/page.tsx`
- **Entity type:** `promotion`

#### `cms_version_rollback`
CMS page content was rolled back to a previous version.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-cms-versions.ts`
- **Entity type:** `cms_page`
- **Details:** `{ page_slug }`

#### `cms_versions_cleaned`
Old CMS page versions were cleaned up (deleted).

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-cms-versions.ts`
- **Entity type:** `cms_page`
- **Details:** `{ page_slug, keep_count }`

### Agreement Category (Timeline) — Added 2026-03-20

#### `agreement_status_checked`
Staff manually checked the signing status of an agreement via the AgreementCard.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/AgreementTimeline.tsx` (AgreementCard)
- **Entity type:** `rental`
- **Details:** `{ agreement_id, new_status }`

#### `agreement_resent`
Staff resent an agreement for signing via the AgreementCard.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/AgreementTimeline.tsx` (AgreementCard)
- **Entity type:** `rental`
- **Details:** `{ agreement_id, agreement_type }`

#### `agreement_sent` (AgreementTimeline)
Staff sent an original or extension agreement from the timeline.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/AgreementTimeline.tsx`
- **Entity type:** `rental`
- **Details:** `{ agreement_type, extension_number }`

#### `bonzah_alert_config_updated` (use-bonzah-alert-config)
Bonzah low-balance alert threshold or enabled state was changed.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-bonzah-alert-config.ts`
- **Entity type:** `settings`
- **Details:** `{ threshold, enabled }`

### Fines Category (Payment Sync) — Added 2026-03-20

#### `fine_charged` (payment sync — detail page)
Fine status was updated to Paid or Charged after a payment was recorded on the fine detail page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/fines/[id]/page.tsx`
- **Entity type:** `fine`
- **Details:** `{ new_status, trigger: "payment_sync" }`

#### `fine_charged` (payment sync — list page)
Fine status was updated to Paid or Charged after a payment was recorded on the fines list page.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/fines/page.tsx`
- **Entity type:** `fine`
- **Details:** `{ new_status, trigger: "payment_sync" }`

### Messages Category — Added 2026-03-20

#### `message_sent`
A staff member sent a chat message to a customer.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/contexts/RealtimeChatContext.tsx`
- **Entity type:** `message`
- **Details:** `{ customer_id, channel_id }`

#### `bulk_message_sent`
A staff member sent a bulk message to multiple customers at once.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/contexts/RealtimeChatContext.tsx`
- **Entity type:** `message`
- **Details:** `{ customer_count }`

### Rental Category (Key Handover) — Added 2026-03-20

#### `vehicle_updated` (lockbox code auto-generated)
A lockbox code was auto-generated and saved to the vehicle during key handover.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/key-handover-section.tsx`
- **Entity type:** `vehicle`
- **Details:** `{ field: "lockbox_code", auto_generated: true }`

#### `rental_updated` (delivery method — lockbox)
Rental delivery method was set to lockbox during key handover.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/key-handover-section.tsx`
- **Entity type:** `rental`
- **Details:** `{ field: "delivery_method", value: "lockbox" }`

#### `rental_updated` (delivery method — in person)
Rental delivery method was set to in-person during key handover.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/rentals/key-handover-section.tsx`
- **Entity type:** `rental`
- **Details:** `{ field: "delivery_method", value: "in_person" }`

### Vehicle Category — Added 2026-03-20

#### `service_record_created`
A new service record was added to a vehicle.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-services.ts`
- **Entity type:** `vehicle`
- **Details:** `{ service_type, cost, service_date }`

#### `service_record_updated`
An existing service record was edited.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-services.ts`
- **Entity type:** `vehicle`
- **Details:** `{ service_record_id, service_type, cost }`

#### `service_record_deleted`
A service record was deleted.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-services.ts`
- **Entity type:** `vehicle`
- **Details:** `{ service_record_id }`

#### `vehicle_expense_created`
A new expense was recorded for a vehicle.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-expenses.ts`
- **Entity type:** `vehicle`
- **Details:** `{ category, amount, expense_date }`

#### `vehicle_expense_deleted`
A vehicle expense was deleted.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-expenses.ts`
- **Entity type:** `vehicle`
- **Details:** `{ expense_id }`

#### `vehicle_file_uploaded`
A file (PDF, document, image) was uploaded to a vehicle.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-files.ts`
- **Entity type:** `vehicle`
- **Details:** `{ file_name, content_type, size_bytes }`

#### `vehicle_file_deleted`
A vehicle file was deleted.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-files.ts`
- **Entity type:** `vehicle`
- **Details:** `{ file_id, file_name }`

#### `vehicle_photo_updated`
A vehicle's main photo was uploaded or replaced.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-photo.ts`
- **Entity type:** `vehicle`
- **Details:** `{ action: "uploaded", vehicle_reg }`

#### `vehicle_photo_deleted`
A vehicle's main photo was removed.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-photo.ts`
- **Entity type:** `vehicle`
- **Details:** `{ action: "removed", vehicle_reg }`

#### `vehicle_extra_updated`
A per-vehicle extra price override was set or updated.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-extras.ts`
- **Entity type:** `vehicle`
- **Details:** `{ extra_id, price }`

#### `vehicle_extra_deleted`
A per-vehicle extra price override was removed.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/hooks/use-vehicle-extras.ts`
- **Entity type:** `vehicle`
- **Details:** `{ extra_id }`

#### `vehicle_updated` (edit dialog)
Vehicle details were edited via the Edit Vehicle dialog.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/components/vehicles/edit-vehicle-dialog.tsx`
- **Entity type:** `vehicle`
- **Details:** `{ reg, make, model }`

#### `vehicle_updated` (lockbox code)
Vehicle lockbox code was saved or cleared.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/vehicles/[id]/page.tsx`
- **Entity type:** `vehicle`
- **Details:** `{ field: "lockbox_code", has_code }`

#### `vehicle_updated` (availability toggles)
Vehicle availability for a booking duration tier was toggled.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/vehicles/[id]/page.tsx`
- **Entity type:** `vehicle`
- **Details:** `{ field: "available_daily" | "available_weekly" | "available_monthly", value }`

#### `vehicle_updated` (mileage allowance)
Vehicle mileage allowance settings were updated.

- **Actor:** portal staff
- **Logged in:** `apps/portal/src/app/(dashboard)/vehicles/[id]/page.tsx`
- **Entity type:** `vehicle`
- **Details:** `{ field: "mileage_allowance", daily, weekly, monthly, excess_rate }`

### Vehicle Coverage Status

| Call Site | Audit Coverage |
|---|---|
| `use-vehicle-services.ts` — add/edit/delete | ✅ `service_record_created` / `service_record_updated` / `service_record_deleted` |
| `use-vehicle-expenses.ts` — add/delete | ✅ `vehicle_expense_created` / `vehicle_expense_deleted` |
| `use-vehicle-files.ts` — upload/delete | ✅ `vehicle_file_uploaded` / `vehicle_file_deleted` |
| `use-vehicle-photo.ts` — upload/remove | ✅ `vehicle_photo_updated` / `vehicle_photo_deleted` |
| `use-vehicle-extras.ts` — upsert/remove | ✅ `vehicle_extra_updated` / `vehicle_extra_deleted` |
| `edit-vehicle-dialog.tsx` — edit vehicle | ✅ `vehicle_updated` |
| `vehicles/[id]/page.tsx` — lockbox code | ✅ `vehicle_updated` |
| `vehicles/[id]/page.tsx` — availability toggles | ✅ `vehicle_updated` |
| `vehicles/[id]/page.tsx` — mileage allowance | ✅ `vehicle_updated` |
| `add-vehicle-dialog.tsx` — create vehicle | ✅ `vehicle_created` (pre-existing) |
| `vehicle-disposal-dialog.tsx` — dispose | ✅ `vehicle_status_changed` (pre-existing) |
| `vehicle-undo-disposal-dialog.tsx` — undo dispose | ✅ `vehicle_status_changed` (pre-existing) |
| `vehicles/[id]/page.tsx` — delete vehicle | ✅ `vehicle_deleted` (pre-existing) |
