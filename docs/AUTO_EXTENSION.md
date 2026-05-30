# Auto-Extension Rentals

A regular rental that **auto-renews each period (weekly/monthly) and charges UPFRONT**, until
the customer returns the vehicle. This is the correct model for operators who collect *in advance*
(e.g. RevTek / Kris) — as opposed to **PAYG**, which is arrears (pay *after* use, accrues daily).

It is built as an **additive, opt-in mode** layered on the existing **rental extension** feature.
PAYG, installments, and normal regular rentals are untouched.

## Why extensions (not a new billing engine)

Kris's ask was literally *"regular rentals with auto-extension, cars show as rented."* So instead
of inverting PAYG (arrears → prepaid) we reuse the proven extension rails:

- `rental_extensions` table (one row per period, sequence-numbered, own Stripe session, FIFO isolation by `extension_id`)
- `Extension *` ledger categories + `payment_apply_fifo_v2` extension isolation
- `finalize_rental_extension(p_extension_id, p_payment_id)` RPC — marks the extension paid and rolls `rentals.end_date` forward (guarded so it never shrinks)
- `create-extension-checkout` (pay-link path) / off-session charging (auto-charge path, same Stripe plumbing as deposit-hold refresh)

A long auto-extending rental simply produces one extension row per period — clean per-week reconciliation.

## Lifecycle

A rental with `auto_extend_enabled = true`, a period (`auto_extend_period_unit`), a per-period amount
(`rentals.monthly_amount` — already "amount per period"), and a next-charge timestamp
(`auto_extend_next_charge_at`, anchored to the current paid period's end).

A cron (`auto-extend-rentals`, every 15 min) scans rentals where the next charge is due and, per rental:

1. Compute the next period: `new_end_date = end_date + period`.
2. Compute the upfront breakdown: rental (`monthly_amount`) + tax (`tenants.tax_percentage`) + service fee.
3. Create the `rental_extensions` row (`sequence_number = max+1`, `status='approved'`) and insert the
   `Extension Rental / Extension Tax / Extension Service Fee` ledger charges with `extension_id` stamped
   and `due_date = new_end_date` — exactly mirroring `AdminExtendRentalDialog`.
4. Charge **upfront**, by mode:
   - **`auto_charge`** (a card is on file via the deposit-hold flow:
     `deposit_hold_stripe_customer_id` + `deposit_hold_payment_method_id`): create an off-session
     PaymentIntent (`confirm:true, off_session:true`). On success → record a `Completed` payment
     (stamped `extension_id`), settle it (FIFO into `Extension*`), then `finalize_rental_extension`
     rolls `end_date` forward. Advance `auto_extend_next_charge_at`.
   - **`pay_link`** (no saved card, or mode chosen): create a Checkout session (like
     `create-extension-checkout`), insert a `Pending` payment, email the customer a "pay for next
     period" link, and park `auto_extend_pending_extension_id`. The **existing webhook → finalize**
     path rolls the date forward when they pay. The cron will not re-create while a pending
     extension is unpaid.
5. On a failed auto-charge: increment `auto_extend_failed_attempts`; retry on the next cron until
   `tenants.auto_extend_max_retries`; past the grace window pause (`auto_extend_paused = true`) and notify.

On return/close: stop auto-extending; prorate/refund the unused part of the last paid period
(handled at finalize-return time — see "Open items").

## Schema (additive)

`rentals`:
`auto_extend_enabled`, `auto_extend_charge_mode`, `auto_extend_period_unit`,
`auto_extend_next_charge_at`, `auto_extend_lead_hours`, `auto_extend_charge_count`,
`auto_extend_max_periods`, `auto_extend_last_charge_at`, `auto_extend_paused`,
`auto_extend_paused_at`, `auto_extend_failed_attempts`, `auto_extend_pending_extension_id`,
`auto_extend_status`.

`tenants`:
`auto_extend_enabled` (master toggle), `auto_extend_default_charge_mode`,
`auto_extend_default_lead_hours`, `auto_extend_grace_hours`, `auto_extend_max_retries`.

## Idempotency & safety

- The cron is idempotent: it only acts when `auto_extend_next_charge_at <= now()`, and advances the
  pointer in the same write — a second tick in the same window finds nothing due.
- A pending (unpaid) pay-link extension blocks creating another, preventing double-billing.
- `auto_extend_max_periods` caps a runaway rental; failed charges pause rather than loop.
- All money flows through the existing ledger + `finalize_rental_extension`, so balances stay correct
  and per-period reconciliation is isolated by `extension_id`.

## Open items (tracked, built in stages)

1. Migration of existing PAYG customers (Giovante & co.) → auto-extension, preserving paid ledger history.
2. Proration/refund of the unused last period on early return.
3. Portal Settings toggle + per-rental "auto-extend" choice at creation.
4. Optional Bonzah-per-period insurance on each auto-extension.
