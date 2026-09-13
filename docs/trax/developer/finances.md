# Financial data lineage — developer reference, excluded from retrieval

Rental-level money and Stripe account funds are different domains.

## Internal financial behavior

useRentalPayments includes payments connected through payment_applications, not only payments.rental_id. buildLedger and totals distinguish charges, received funds, allocations, outstanding amounts, refunds, unapplied credit and deposit holds. useRentalChargesAndPayments treats PAYG accruals and rental_extension_totals separately to avoid double counting extension charges.

The payment_apply_fifo_v2 function and apply-payment perform writes and side effects. They must never run during a read-only support answer. Pure financial projections need reviewed server reuse rather than a second model-calculated balance. Existing fixed two-decimal and USD-oriented helpers do not prove all currencies are supported.

## Processor and object mapping

stripe-client.ts distinguishes UK and UAE platforms. New charge routing uses getChargePlatformAccount; historical records carry platform_account. getConnectAccountId handles managed/own configurations and test/live accounts. Some test paths use a shared Connect account. A shared account balance is not a tenant-owned balance.

create-checkout-session records Checkout Session and platform links and places rental/tenant/extension/PAYG/installment metadata on the checkout flow. Later payment objects can carry stripe_payment_intent_id. Authorization/capture is distinct from successful collection. Square is also implemented; failed provider resolution must not be presented as proof that Stripe is the provider.

The future adapter must use restricted read-only credentials, the verified platform/mode/account context, and exact internal object links. Missing provenance is an explicit limitation. Do not scan Stripe by customer name or amount to guess a match.

## Existing misleading read paths

audit-stripe-payment has no sufficient staff/tenant gate in its handler and a net_at_stripe calculation based on pi.amount rather than only received funds. fetch-payment-intent can update a payment link. verify-deposit-hold corrects internal hold records. getCustomerIdForAccount can repair customer mappings. These are not approved Phase 1 tools.

No Stripe credentials, customer transaction examples, account balances or financial snapshots belong here. The next phase requires a reviewed finance permission matrix, deployed environment mappings, historical provenance and dedicated restricted credentials.

## Sources and tests

- apps/portal/src/hooks/use-rental-ledger-data.ts: useRentalPayments, useRentalTotals.
- apps/portal/src/components/rentals-v2/rental-detail/payments-model.ts: buildLedger, remainingOn, unallocatedOn, heldOn, totals.
- apps/portal/src/hooks/use-customer-balance.ts: useRentalChargesAndPayments.
- supabase/functions/_shared/stripe-client.ts: getConnectAccountId, getChargePlatformAccount, getStripeClientForRecord.
- supabase/functions/create-checkout-session/index.ts: session creation and internal mappings.
- supabase/functions/_shared/payments/resolve.ts: provider selection.
- apps/portal/src/__tests__/components/deposit-hold-verify-permissions.test.ts.
- tests/integrations/stripe/README.md: offline contracts versus opt-in money-moving tests. Do not run the latter as part of this foundation.

