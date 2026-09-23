# Integration subscriptions (premium integrations) — build spec

Branch `haseeb/subs-integration`, cut from `haseeb/agreements-v2` @ `3de4b762`.
Ticket: "Integration subscriptions: premium pricing and how it's billed" (Supercut 10:07) plus Ghulam's transcript.

## What was asked (ticket + transcript, in plain words)

1. **End credits for northwind.** "Credits pe kuch bhi nahi hona chahiye." Operators read credits as a second bill on top of the software. BoldSign becomes free: no e-sign send takes credits. The Billing page's Credits section ("a completely separate vertical") is removed. **Northwind only for now:** "we can't cut everyone off yet".
2. **Two kinds of integration: free and premium.** A premium card shows a small **crown**. There is **no free/premium filter** ("we don't have that many").
3. **Premium dialog.** The operator can open a premium integration and read about it (FOMO). It has a **Subscribe** button, and payment happens **inside that same dialog** without scrolling.
4. **The model.** The first month is free when the super admin says so. After that the integration's monthly price (the video's example is $20 on top of $200 for the software) rides on the operator's platform subscription. It is billed **on the same bill** as the platform fee, **every month**, with no separate card flow.
5. **The gap.** Suppose the platform bills on the 15th and the operator subscribes on the 20th. Drive247 absorbs those days ("ye gap bhi hum khud bardasht karenge"). The copy is "**$20 will be added to your next bill.**"
6. **Invoice lines.** The invoice shows **Platform subscription 200** and **Inshur subscription 20** as **two lines**, never one merged "220". The same goes for the Billing page's **next invoice**, which also says **when** that invoice comes.
7. **Super admin** gets a new **Integrations** tab with these controls per integration:
   - premium or not;
   - the monthly price;
   - whether the first month is free;
   - **hide** the integration;
   - a **Beta** flag;
   - **Not available**, which dims the card slightly.
8. **Test it.** Make any integration premium (the transcript's own test suggestion) and simulate the billing day to check it works.

## Decisions

- **D1 Gate.** Northwind only, by SLUG: `lib/integration-billing/gate.ts` → `INTEGRATION_BILLING_TENANTS = [NORTHWIND]`, `isIntegrationBillingTenant(slug)`.
  - It is NOT a `V2Area`, because `isV2()` ORs `portal_experience='v2'`, which would widen it to every self-serve v2 tenant. The ticket says "northwind gets it, every other tenant keeps their current billing."
  - The same one-line list is mirrored in `apps/booking/src/lib/integration-billing-gate.ts` and `supabase/functions/integration-billing/gate.ts`. A test pins all three copies equal.
- **D2 Credits retired (northwind), server side.** Credits are skipped only where they are actually charged:
  - portal `/api/esign`;
  - booking `/api/esign`;
  - the `agreements-v2` edge function.

  In each place, "skip credits" means no `deduct_credits`, no refund, no low-credit alert and no auto-refill. It is decided on the tenant that OWNS the rental: the body's tenant id must equal the rental's tenant, and that row's slug must be in the list. So naming northwind's id in a request can never make another tenant's send free.

  Out of scope, documented rather than edited:
  - `create-boldsign-document`, which is used by automations and leads. Both are hidden for northwind (lean).
  - The `retry-credit-failed-agreements` cron, which only retries rows that failed for credits; northwind can no longer produce those.

  Additive `if`s only; v1 behaviour is byte-for-byte unchanged for every other tenant.
- **D3 Credits retired (northwind), UI.** For the gate tenant:
  - the top-bar credits pill is gone;
  - the dashboard low-credits banner is gone;
  - the Billing page's Credits section is gone;
  - `/credits` redirects to `/subscription`;
  - the BoldSign panel's chip no longer reads the wallet, and its Credits section is replaced by one line: "E-signatures are included with your plan. No credits needed.";
  - the Agreements v2 send and resend copy drops "Sending uses e-sign credits."
- **D4 Catalog (global, super-admin owned).** New table `integration_catalog_v2`, one row per board card, keyed `integration_key`. *(Updated Sep 22 2026, see the section at the end: premium no longer requires a price, and three integrations are premium by default.)*
  - Columns: `is_premium`, `monthly_price_cents` (USD, 50..1,000,000, required when premium), `first_month_free`, `is_hidden`, `is_beta`, `is_unavailable`, `updated_at`, `updated_by`.
  - A missing row means free and visible. That is today's board, so the code is safe to ship before the SQL.
  - Read: portal staff and super admins (`is_portal_staff()`, the setup-checklist pattern). Renters can't read it.
  - Write: super admins, directly from apps/admin through RLS (`is_super_admin()`).
- **D5 Subscriptions.** New table `tenant_integration_subscriptions_v2`, one row per subscribe.
  - Statuses: `pending` → `active` → `canceled` (or `failed`).
  - A partial unique index on (tenant, integration) WHERE status IN ('pending','active') makes a double click or a race create ONE Stripe item.
  - Tenant staff may SELECT their own tenant's rows. Only service_role writes.
- **D6 Billing mechanics (Stripe, platform account).** The integration is a new **subscription item** on the tenant's existing platform subscription.
  - Account and mode come from the `tenant_subscriptions` row and `tenants.subscription_stripe_mode`, through `_shared/subscription-stripe.ts`, which is imported and not edited.
  - The item is added with `proration_behavior: 'none'`, so the gap is free and nothing is charged today. It appears on the next bill and on every bill after it, as its own line.
  - Product id `d247_integration_<key>`, named "<Name> subscription". Its Price is found by `lookup_key` `d247_integration_<key>_<currency>_<cents>_month`, so a price change mints a new Price for new subscribers only.
  - No existing subscription function is edited. The webhook's `customer.subscription.updated` handler never reads item amounts, and the reconciler takes the LARGEST licensed amount. Limitation, noted in the admin UI: an integration priced above a tenant's plan would read as the plan amount there.
- **D7 First month free.** The next invoice carries a one-off credit line for the full monthly price ("<Name> subscription: first month free"). It is a pending invoice item attached to that subscription, which is long-standing Stripe API, not item-level discounts.
  - It applies only the FIRST time that tenant ever subscribes to that integration.
  - If a later step fails, the item is removed again. The credit is deleted on cancel while it is still pending.
- **D8 Preconditions to subscribe:**
  - the gate tenant;
  - a premium entry with a price that is neither hidden nor not-available;
  - a live platform subscription (active or trialing) that is not set to cancel;
  - currency `usd`;
  - interval `month`;
  - the caller may edit Settings › Subscription (head_admin/admin, or a manager with editor on `settings` + `settings.subscription`, and never a viewer).

  Anything else gets a plain answer and no Stripe call.
- **D9 Board (northwind).**
  - Hidden cards are removed.
  - A premium card shows a small crown at top-left (mirroring the pin).
  - Beta shows a small "Beta" pill beside the name.
  - Not available dims the card (`opacity-60`) and its chip reads "Not available".
  - One line under the header says what the crown means.
  - Everyone else's board is unchanged.
- **D10 Premium dialog.** Directly under the dialog header, above the panel, is the premium block:
  - the price;
  - first month free, if set;
  - "Added to your Drive247 bill";
  - a Subscribe button.

  Subscribe swaps the dialog body for a compact **confirm step**, so nothing needs scrolling. It shows:
  - the monthly price;
  - the free month;
  - the next bill date;
  - the card on file;
  - "$X will be added to your next bill".

  "Subscribe for $X/month" calls the edge function. There is nothing to type, because the card on file is the one the platform bill already uses.

  Until the operator subscribes, the panel renders **read-only** (`<fieldset disabled>`) so they can read it but not connect. Not available renders the same way with a note. After subscribing, the panel is live.
- **D11 Billing page (northwind).** A **Next invoice** card shows:
  - the date;
  - one row per line: "Platform subscription", "<Name> subscription", and "<Name> subscription: first month free" as a negative line;
  - the total.

  It comes from Stripe's upcoming-invoice preview, which is also the "simulate the billing day" check. The receipt viewer shows the same per-line breakdown for past invoices, fetched from Stripe on open. The shared `LocalInvoiceView` gets an OPTIONAL `lines` prop, so everyone else renders exactly as before.
- **D12 Super admin.** `/admin/integrations`, in Configuration:
  - a table of every board integration with the six controls;
  - Save writes the catalog;
  - each premium row lists its subscribers, with **Cancel** (edge function).

  Cancel removes the Stripe item without proration and deletes a still-pending free-month credit. Operators cancel through support, which matches the platform subscription's own cancel-request pattern.
- **D13 Edge function** `integration-billing` (verify_jwt ON). Actions:
  - `subscribe` (operator);
  - `upcoming` (operator, next-invoice lines);
  - `invoice_lines` (operator, one past invoice, which must belong to the tenant's own Stripe customer);
  - `cancel` (super admin).

  Pure `core.ts` with injected db, Stripe and clock, tested by `tests/integrations/integration-billing`.

## Not live until

- `ops/integration_billing_v2.sql` is applied. Until then the board and the Billing page look exactly as today (plus the credit removals, which need no SQL), and Subscribe answers "not set up yet".
- `supabase functions deploy integration-billing --project-ref hviqoaokxvlancmftwuo` and `supabase functions deploy agreements-v2 …` (credit skip).
- Vercel deploys of portal, booking and admin.

## Hardening after the billing review (Sep 22 2026)

The review found no blockers. These failure paths were closed, and each has a test:

- **Lost Stripe response.** A create whose response was lost did happen at Stripe. The undo first looks for it by the claim's own `d247_claim_id` metadata, and deletes it if it is there. If that look-up itself fails, the row stays `pending`. Only a confirmed undo marks the row `failed` ("nothing was charged").
- **Item id on record at once.** The item id is written the moment it exists, so a killed isolate still leaves a findable item. A pending row older than 10 minutes says "stuck" in the portal and in the admin table.
- **Cancel during a subscribe.** Activation is guarded on `status = 'pending'`. A claim a super admin canceled mid-subscribe is never revived; its item is taken off again.
- **Ended platform subscription.** A row whose platform subscription is no longer live is closed on the next subscribe. The portal does not call it "Subscribed", and Cancel skips the item delete, because the item went with the subscription.
- **Admin changes the catalog under a subscriber.** A subscriber keeps seeing what they pay for (crown, their price, never hidden) whatever the catalog says now. The admin page refuses to make an integration free or hidden while it has live subscribers.
- **Free month.** It is used up only by actually reaching a bill (`first_bill_at` ≤ `canceled_at`).
- **Price records.** An adopted item records its own price, and `prices.create` passes `transfer_lookup_key`.
- **Next invoice with a cancel date.** A `cancel_at` after the period end still shows the next invoice.
- **Cancel partial failure.** If the credit cannot be removed, the row is still closed, and it says which credit to delete by hand.
- **Known, accepted:**
  - A one-time percent coupon at subscription level also discounts the integration line. The free-month credit is fixed, so Drive247 loses a little on that one bill; the tenant is never overcharged.
  - `base_amount` on the invoice row merges every licensed line. That is why the receipt fetches lines from Stripe, and falls back to one merged row only when that fetch fails.
  - The esign routes are unauthenticated. This is pre-existing and not changed here.

## Premium defaults and "price to be announced" (Sep 22 2026, at Haseeb's request)

- **Defaults.** Inshur, Turo Sync and CheckMyDriver are premium by default (`DEFAULT_PREMIUM_KEYS`, in the portal and the admin page, pinned equal). They wear the crown before any catalog row exists, even before the SQL is applied. A saved row always wins over a default, in both directions. The portal draws no marks until the saved catalog has loaded, so a default never flashes a crown on a card a super admin has made free.
- **Premium and price are separate.** A premium integration with no price reads "Price to be announced" and cannot be bought: the portal disables Subscribe and the edge function answers `no_price`. The premium-has-price CHECK was dropped from `ops/integration_billing_v2.sql`, and a blank price saves as NULL.
- **Coming soon.** The three are also `PREVIEW_ONLY_KEYS`, so they are never sold until their panels launch. The edge function refuses them first (`coming_soon`). The copy says "Nothing is charged unless you subscribe after it launches"; nothing is ever charged without a subscribe.
- **Admin safety.** If the catalog or the subscriber list fails to load for any reason other than a missing table, Save is locked. Otherwise one click would overwrite every saved price and flag with the defaults, and would skip the "has subscribers" guard.
- **Missing Stripe key.** If there is no Stripe key for a tenant's account and mode, the answer is `not_set_up` before the claim row is written, so no pending row is left stuck.
- **Release order.** Apply the SQL, deploy `integration-billing`, deploy `agreements-v2`, then do the Vercel release of the portal, booking and admin. `agreements-v2` goes before Vercel so northwind is never shown "no credits" while still being charged them. **Do not deploy `trax-support` from this branch**: 3 bundled files and 4 new files differ from what is live, and that is other work. Commit before deploying, so the deployed code matches a commit.
