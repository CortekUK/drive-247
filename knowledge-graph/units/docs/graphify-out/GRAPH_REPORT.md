# Graph Report - docs  (2026-09-04)

## Corpus Check
- 53 files · ~181,977 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 972 nodes · 1230 edges · 63 communities detected
- Extraction: 77% EXTRACTED · 23% INFERRED · 0% AMBIGUOUS · INFERRED: 285 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]

## God Nodes (most connected - your core abstractions)
1. `leads table — the pre-rental opportunity record replacing enquiries` - 21 edges
2. `Task B — Bonzah insurance addendum injected into every rental agreement` - 13 edges
3. `submit-application edge function — public entry point that validates, dedups, blacklists, scores and creates the lead` - 12 edges
4. `Dedicated cron-free staging project + dedicated Stripe Sandbox as the simulation environment` - 11 edges
5. `scripts/sim/helpers.mjs — shift / resetOneshots / fire / assertRows simulation harness` - 10 edges
6. `Multi-service Time Machine covering every cron-driven rental service` - 10 edges
7. `process-accounting-sync worker — batched FOR UPDATE SKIP LOCKED drain of pending sync rows` - 10 edges
8. `Task A — booking checkout Bonzah disclosure block update` - 10 edges
9. `Auto-extension rentals: prepaid recurring per-period billing until return` - 9 edges
10. `Time Machine / Cron section in the portal DevPanel` - 9 edges

## Surprising Connections (you probably didn't know these)
- `BUNDLE_EXTRA_EXCLUSIONS — existing 'compliance text, do not reword' constant, the precedent for hardcoded insurer wording` --semantically_similar_to--> `injectBonzahInsuranceAddendum(html, tenant) — new tenant-gated addendum injector`  [INFERRED] [semantically similar]
  apps/booking/src/components/BonzahInsuranceSelector.tsx → supabase/functions/_shared/agreement-injection.ts
- `Reuse map — the source of truth listing existing Drive247 surfaces that MUST NOT be re-implemented` --references--> `Portal manager-permission tab-key registry (TAB_KEYS / TAB_GROUPS / ROUTE_TAB_MAP)`  [EXTRACTED]
  docs/LEAD_MANAGEMENT_AND_AUTOMATIONS.md → apps/portal/src/lib/permissions.ts
- `Bonzah compliance surfaces gate on tenants.integration_bonzah only` --conceptually_related_to--> `Portal Bonzah settings — where integration_bonzah is turned on per tenant`  [EXTRACTED]
  docs/bonzahv2/Bonzah_Compliance_Spec_for_Haseeb.pdf → apps/portal/src/components/settings/bonzah-settings.tsx
- `injectBonzahInsuranceAddendum(html, tenant) — new tenant-gated addendum injector` --reads_table--> `tenants.integration_bonzah — single Bonzah enablement flag (no second flag, no tenant-name hardcoding)`  [EXTRACTED]
  supabase/functions/_shared/agreement-injection.ts → docs/bonzahv2/Bonzah_Compliance_Spec_for_Haseeb.pdf
- `injectBonzahInsuranceAddendum(html, tenant) — new tenant-gated addendum injector` --implements--> `Idempotency marker so re-rendering an agreement never duplicates the addendum`  [EXTRACTED]
  supabase/functions/_shared/agreement-injection.ts → docs/bonzahv2/Bonzah_Compliance_Spec_for_Haseeb.pdf

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (111): auto_charge mode: off-session PaymentIntent on the saved deposit-hold card, Auto-extension rentals: prepaid recurring per-period billing until return, auto-extend-rentals cron (every 15 min) scans rentals whose next charge is due, Auto-charge reuses the deposit-hold saved card (deposit_hold_stripe_customer_id + payment_method_id), Extension ledger categories + payment_apply_fifo_v2 isolation by extension_id, finalize_rental_extension RPC rolls rentals.end_date forward (guarded so it never shrinks), Idempotency: pointer advanced in the same write, pending pay-link blocks re-creation, max_periods cap, ledger_entries (+103 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (106): accept-offer edge function — validates flex window, re-checks availability, 409s on vehicle_just_taken, GIVEN/WHEN/THEN acceptance criteria used as the QA contract, Automation step types — sms, email, wait, condition (safe whitelisted evaluator), stop, ai-draft-message edge function — drafts in the tenant's communication_tone, ai-extract-from-conversation edge function — mines the thread for application_data fields above 0.7 confidence, AI layer principles — structured output only, never a chatbot, deterministic fallback, 5-minute cache, logged calls, Right column — AI next action, matching engine, running automations and quick actions, Per-tenant AI monthly quota with hard stop; AI usage billing deferred to a separate project (+98 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (88): agreement-injection.ts exists byte-identically in portal, booking and _shared and must be edited in all three, EC-31/32/86 the deposit clause exists in one of four templates, resolves from a column that does not exist, and contradicts the rebase, Amount rebase: the hold covers unpaid + anticipated rent, not a damage buffer, EC-18/19 deposit_hold_attempt_seq replaces the enumerated idempotency-key suffix scheme, AUTH_DISCLOSURE_HTML: non-tenant-editable card-authorization clause injected into every agreement, auto-extend-rentals cron (off-session renewal billing on the same card as the hold), EC-20 unbounded serial refresh loop silently truncates an arbitrary subset, The three booking Stripe webhooks (stripe-webhook-live / -test / legacy) (+80 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (80): accrue payg charges dailyaccrual, app_users table, capture deposit hold partialcapture, create hold checkout dead pi status map, Amendment A7: per-job advisory-lock lease (409 when held) plus a scenario-scope lock, so dispatch can never overlap cron, Blocker 2: identity checks must key on app_users.auth_user_id, not app_users.id — this repo was bitten by the same mistake before, Major 6: manual dispatch overlapping cron double-charges — process-installment-payment creates PaymentIntents with no idempotency key or lock, Major 9: time travel must shift payg_next_accrual_at, payg_start_ts and start_date as one coherent unit or accruals predate the rental (+72 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (67): Gate 1: anchor each hold to the Stripe account it was created on, Monitoring screens must reuse the portal design system (flat borders, indigo, DM Sans), Phased build order — migration, notify function, readiness board, unified tab, polish, rentals.creation_context — frozen integration-mode snapshot at rental creation, Capture rental creation with a Postgres trigger instead of app code, Planned scaling exit: real-time email for critical only, roll ok/warning into a daily digest, Cheap extra signals: first-ever rental milestone and $0 / no-payment-captured flag, rentals.health_severity — computed ok/warning/critical verdict (+59 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (62): apply payment extensionisolation, apply payment fifoallocator, apply payment ledger allocation, bonzah calculate premium estimator, bonzah confirm payment policyissuance, calculate excess mileage excessmileagebilling, create checkout session deposit disclosure, create extension checkout server authoritative (+54 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (50): stripe-webhook — checkout/payment_intent lifecycle events, create-checkout-session edge function (tenant resolved via x-tenant-slug), Automated payment mode: charge transfers straight to the tenant's connected account, Partial refund path (refund_amount + "Partial Refund" payment status), Manual-approval mode: card hold (requires_capture) then staff capture activates the rental, Pre-auth rejection releases the hold and cancels payment + rental with no money moved, Refunds use reverse_transfer, pulling money back out of the tenant's Stripe balance, Scheduled refund processed later by a cron job (refund_status scheduled → completed) (+42 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (43): Agreement injection — booking copy, injectBonzahInsuranceAddendum(html, tenant) — new tenant-gated addendum injector, Agreement injection — portal copy, Agreement injection — shared edge-function copy, Existing {{terms_and_conditions}} CMS clause injector — the pattern the addendum injector mirrors, agreement-terms.ts — clause content fetching used alongside the injector, Addendum clause 9 — coverage applies only to drivers named on the rental agreement and insurance application, Addendum clause 5 — 24-hour cycles, purchase before pickup, extensions before lapse, gaps cannot be backfilled (+35 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (35): add payment dialog chargesavedcard, auto extend rentals autochargepath, charge deposit dialog fullcaptureonly, create connected account express onboarding, Prod bug: the installment plan SELECT omits failure_count so handleFailure always writes 1 — the >=3 overdue cascade is unreachable in production, Major 12: some columns are disqualifying when backdated — payments.created_at anchors recover-pending-stripe-payments to real now, so shift() must refuse it, Double-entry financial core: ledger_entries charges vs payments, reconciled by remaining_amount, deduct from deposit excessmileagededuction (+27 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (31): blocked dates manager availabilityblocking, blocked dates manager rentalconflictcheck, calculate rental price calculaterentalpricebreakdown, calculate rental price dailypricing, calculate rental price manualdayoverride, calculate rental price surchargeapplication, cancel booking preauth bookingrejection, capture booking payment bookingapproval (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (25): Blocked Dates / Fleet Calendar as the manual anti-double-booking workaround, Turo calendar-sync API discontinued — no automatic Turo availability sync, AI price suggestion shown as clean base plus the markup-adjusted final price, Fleet calendar renders every vehicle, not only blocked/booked ones, Customer-facing car list + booking widget show weekly/monthly rate with seasonal markup applied, Jangram — Sam's feedback fixes, round 2 (6 completed fixes), Drag-to-block landed two days early — off-by-range selection bug, Drag pre-fills the block dialog so exact dates are confirmed before save (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.1
Nodes (22): Card lifecycle across a 90-day chain (EC-13/14/71/72/73/74): expiry, reissue, CAU, brand change, re-minted customer, check-migration-readiness edge function (UK->UAE flip gate), Where each consent is captured and where it must be persisted, EC-45 currency read from the live tenant: a USD->GBP settings flip over-authorizes an in-flight hold, D1 GMT cannot migrate to the UAE platform while chained holds are live (PIs cannot move accounts), EC-04 payment_model flip nulls every customer's stripe_customer_id and strands UK-anchored holds, rental_card_mandates: persist the card-on-file consent that today is rendered but never stored, EC-15/16 renter self-service card update is gated on installment plans and broken for direct-charge tenants (+14 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (19): admin create user staff provisioning, create subscription checkout platformbilling, First real invoice.paid auto-flips stripe_mode and bonzah_mode to live and stamps setup_completed_at, Operator Stripe Connect onboarding and account.updated status sync, Subscription onboarding does a $1 validate-then-refund before the first real charge, Zero application_fee: the platform takes no per-transaction cut, it earns only from subscription, Platform subscription: Drive247 charges the operator monthly, Platform subscription billing runs on a separate Stripe account, unrelated to Connect (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (19): Self-service footer/address editing via portal CMS → Site Settings, Open Bay Rental support response — 9-item technical reply, Native mobile app deferred to roadmap, openbayrental tenant (Open Bay Rental, Los Angeles), Operator login + support-email rebrand (admin@obrental.com) applied by support, not self-service, Inventory of 17 active live-operator Premium plans ($150–$350/month) to recreate, Credit-pack products/prices are auto-created per purchase, so they are deliberately not recreated, Test/demo tenants (acme, delta-fleet, design, moiz, neema, temp, test, test-2) excluded from migration (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (16): damage_claims: Visa Table 5-19 delayed-charge workflow hung off rental_damage_reports, Damage leaves the hold entirely, moving to an LDW/CDW waiver + fleet policy, EC-78 shipping a damage waiver on rental_extras is unlicensed insurance solicitation risk, ABI (INSHUR) per-rental insurance integration - discovery document, ABI is the carrier of record on the vehicle; Bonzah is an optional renter-facing damage waiver, Decision: defer the ABI build; revisit when 2-3 tenants ask or ABI ships host enrollment, No API for enrolling a brand-new car-share host into Period X - one manual portal step per host, If built, ABI mirrors the Bonzah/BoldSign connector shape: per-tenant test/live credentials wired into rental create/complete/cancel (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (16): check migration readiness ukuaereadinessgate, BYO migration: Express platform-created accounts become Standard operator-owned via OAuth, The eight Stripe Connect touchpoints a BYO migration changes, Customer renter journey: browse to paid, All booking charges are direct charges on the operator's connected account, Rationale: payment-spine claims were grepped directly rather than inferred, Cross-cutting notification spine (email, SMS, WhatsApp) with per-tenant template overrides, Caveat: some notify-* function names were agent-reported and must be spot-checked (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (16): charge deposit dialog noinventedlifetime, check migration readiness nonterminalholdblock, check migration readiness savedcardplatformscope, customers table, W9: the rental page branches on held / expired / falsy only, so refreshing, processing and failed render no deposit action at all, and deposit_hold_expires_at is shown nowhere, Risk: the admin 'Flip anyway' button bypasses the migration readiness check, URGENT: authorizations, customers and saved cards cannot move between platform accounts, gmt chained hold critic flip anyway button (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (14): pnl_entries as the Profit & Loss reporting feed (income/expense side + source_ref), expense_categories table, expense dialog stalecategorypreservation, M1: changing a category's P&L bucket never reflows historical pnl_entries — config and P&L silently disagree, M2: deleting a category orphans its expenses and there is no rename — the edit dialog then fails validation, Decision: expense category is free text (enum retired), only loosely coupled to expense_categories rows, Expense Tracker: business-expense ledger built by widening vehicle_expenses, M4: two divergent write paths into vehicle_expenses — the legacy vehicle dialog still hardcodes the retired category enum (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.23
Nodes (13): Approved Twilio Brand (EIN and address matching IRS records) is a hard precondition, A2P 10DLC campaign approval for tenant SMS, Campaign must declare embedded payment/e-sign links and phone numbers, Carrier-required no-third-party-sharing SMS clause in the privacy policy, Documented common A2P campaign rejection causes, Sample messages must carry the brand name and STOP language, Tenant Twilio SMS toggle gates the public compliance pages, Public server-rendered /sms-opt-in consent proof page (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (11): 20260306140000 add whatsapp meta pertenantwhatsapp, boldsign webhook documentstatussync, boldsign webhook nokeyhandoveronsign, BoldSign agreement send/sign with self-sent notifications (DisableEmails true), Lockbox and collection key-handover notification chain, Signing is not activation: marking key handover complete is the true activation, WhatsApp Business verification gates the WhatsApp messaging tab, notify lockbox code capability (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.22
Nodes (9): capture-deposit-hold edge function (capture, rollover, self-heal), EC-40 capture ledger writes are console.error-and-continue; must become one atomic fatal RPC, EC-03 capture must settle real open charges via a non-damage allowlist, not a synthetic Security Deposit charge, deduct-from-deposit edge function (dead code whose fix is a trap), EC-42 delete deduct-from-deposit; route excess mileage through capture-deposit-hold, payment_apply_fifo_v2 cat_order gates which categories a capture can ever settle, EC-43 captured deposits never reach pnl_entries, so the rebase's revenue is invisible on the dashboard, Rationale: never rename the 'Security Deposit' category value - it is string-matched in ~20 places plus an invoices column; change the label only (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): check policy acceptance portalpolicygate, Portal first-login gates: policy acceptance, subscription gate, forced password change, middleware nosubscriptionredirect, An active subscription removes the portal gate and unlocks the dashboard, subscription gate dialog twotiergating, subscription gate serverpaywall, use tenant subscription platformbillingstate

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (6): Insurance approve / reject / rescan moderation on the rental detail page, Insurance certificate is only persisted once the booking completes — abandoned checkouts leave no record, Planned: fewer booking steps with an optional customer account, ID check retained, Card-hold reservations touch calendar, payments, insurance and refunds at once — too risky to rush, Parked: reserve-with-card-hold + payment deadline + auto-release, Deferred: collect ID + insurance after the car is booked rather than before

### Community 23 - "Community 23"
Cohesion: 0.4
Nodes (5): Bug 4: place-deposit-hold hand-rolls a two-rung fallback and never tries the extended-auth-only rung, silently forfeiting ~30-day holds if only multicapture is refused, Testing gap: the sandbox seeds its fixture on the platform test account and all test tenants share one Connect account, so the card-feature ineligibility branch cannot be reproduced at all, place deposit hold card feature downgrade, sim control fire dispatch, stripe client deposit hold feature ladder

### Community 24 - "Community 24"
Cohesion: 0.4
Nodes (5): ai document ocr id extraction, cmd webhook ingestion, create veriff session identityverification, Three identity-verification providers converge on identity_verifications, tbl identity verifications

### Community 25 - "Community 25"
Cohesion: 0.4
Nodes (5): W1: route deposit failures through notifyOperatorsInApp with a dedupeKey, on the existing payment_failed type so bell plus email arrive with zero DDL, Rationale: run the reconciliation backfill before enabling alerting, or day one is an alert storm, the channel gets muted and the alerting is worthless, Do not build alerting on reminders-generate / reminders-digest: the digest's send step is a TODO plus a console.log and the generator's only caller is an uncalled hook, notify inapp dedupe key guard, notify operator email type to category map

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (4): expense dialog orphanreceiptcleanup, Receipts live in a private bucket served by 10-minute signed URLs, never public links, H1: replacing or removing a receipt orphans the old file in the paid private bucket, use expenses receiptstoragelifecycle

### Community 27 - "Community 27"
Cohesion: 0.5
Nodes (4): Card expiry mid-rental is likely on 90 days and completely unmonitored — no payment_method.automatically_updated handler, and brand change is a hard stop for merchant-initiated charges, W9: the customer 'Update Card' flow is hidden behind having an installment plan, so a long-term renter cannot change their card and staff cannot do it for them, Bug 12: refresh reuses rentals.deposit_hold_payment_method_id verbatim and nothing updates it when a customer changes card — guaranteed eventual failure on a long rental, update payment method cardrotation

### Community 28 - "Community 28"
Cohesion: 0.5
Nodes (4): Sharpest customer-harm risk: debit holds can take weeks to clear, so a re-auth cadence lets a renter carry several ringfenced deposits while Stripe shows exactly one, Explicit decision: do NOT reorder to create-before-cancel — two simultaneous full-amount authorizations can themselves cause the insufficient_funds decline they were meant to prevent, and worsen debit stacking, V2: create-before-cancel authorizes 2x the estimate systematically, 13-18 times per rental — defensible only with explicit overlap disclosure, seconds-long overlap and never on debit, Nothing in the codebase reads card.funding, so debit-specific policy cannot be enforced anywhere today

### Community 29 - "Community 29"
Cohesion: 0.5
Nodes (4): D4 open question: cancel-first gaps coverage, create-first authorizes 2x systematically, EC-48 debit release lag stacks two rent-scale encumbrances per link, EC-51 no charge.dispute.* handler exists in any booking webhook; add a disputed hold state, EC-36 no statement_descriptor anywhere: 13-18 unlabelled pending lines drive disputes

### Community 30 - "Community 30"
Cohesion: 0.5
Nodes (4): accrue payg charges idempotency, accrue payg charges payg accrual cron, PAYG daily accrual cron: idempotent by day index with a 30-day catch-up cap, finalize payg rental capability

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (3): accrue payg charges catchupcap, Minor 24: catch-up is tenant-aware maxDaysFor(), so scenarios must assert final DB state and never dispatch counts, Major 8: functions.invoke swallows non-2xx bodies, so 403/401/412 are indistinguishable and a catch-up-capped run looks broken

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (3): Setup Hub tracks two go-live items: Stripe Connect active and Bonzah configured, setup hub trialsetuphub, use setup status golivechecklist

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (3): Reviews run operator-rates-customer, summarised by OpenAI, generate review summary capability, tbl rental reviews

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (3): gmt auth hold 90day plan destructive refresh, Unverified assumption: the deposit refresh cron may never have been scheduled, refresh deposit holds cron

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (3): admin create user staffprovisioning, Blocker 4: a freshly wiped staging project has no super-admin login identity at all — admin-create-user only yields head_admin and emergency-bootstrap hardcodes prod, emergency bootstrap hardcodedadminreset

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): Enquiry-tenant branch: $0 checkout, no charge, rental status Enquiry, Make start/end dates required on the enquiry form, tenant config isenquirybasedtenant

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): Refunds run deposit-first then the PaymentIntent, on the connected account, process refund category scoped refund, process refund payment selection via applications

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): create preauth checkout cardfeaturedowngrade, Extended authorization is an interchange-plus pricing feature, not a regional restriction, Stripe guessed GMT's industry category because vehicle rental was never set

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): 20260605140000 trax price suggest cross tenant price suggestion, fn trax price suggest, Revenue Optimiser: manual override on AI pricing, target 75-80% suggestion accuracy

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): L1: no pagination — the whole tenant's expense set is loaded, then searched and reduced in memory, CSV export deliberately exports only the filtered in-memory view — a pagination change would silently truncate it

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): accrue payg charges cronjob, Roadmap: make the recurring toggle real via a cron job reusing the PAYG / auto-extension cron pattern

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (2): Major 10: one-way transitions (auto_extend_paused, plan overdue, collection_mode='manual') can kill a fixture in one click — mark them irreversible in the manifest, Minor 17: Stripe Sandbox delivers delayed events for up to 7 real days, so fixtures are same-day disposable and teardown must cancel its own PIs

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (2): Bug 11: sync-deposit-hold rewrites rentals.platform_account unconditionally from the tenant's current model, so a browser redirect can re-anchor a UK rental to UAE, sync deposit hold platform anchor guard

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): create preauth checkout bookingpreauth, Bug 21: two different things are both called a 'deposit hold' — booking pre-auths carry a payments row, rental deposit holds do not, so any merged reporting double-counts

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (2): EC-24 Pending-rental holds are released, never chained, Rationale: re-authorizing a card every five days for an uncollected car is indefensible under 5.7.2.4 - release Pending holds instead of chaining them

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (2): charge-deposit-dialog.tsx (operator capture UI, locked to a full capture), EC-38/39 partial capture re-enabled, bounded by selected charges, with a claim + idempotency key

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (2): Subdomain to tenant resolution via the x-tenant-slug header, middleware portaltenantresolution

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (2): manage subscription plans stripepricelifecycle, Saving a plan also creates the Stripe Price object

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (2): capture booking payment buffertimeadvisory, Duplicate-request cooldown (~30 min) to block accidental double-booking

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (2): Two competing verification codes caused permanent 'Invalid Passcode' at signup, Single-source OTP for account creation (platform-wide fix)

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (2): ai document ocr index ts, Roadmap: reuse the existing ai-document-ocr function to autofill vendor/amount/date from a receipt

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): Major 13 / prod bug: daily-reminders buckets are exact midnight-UTC floor math, so the 'due today' bucket is unreachable after 00:00 UTC, daily reminders reminderschedule

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (2): Major 11: anti-rot triple gap — staleness stamped at sync not deploy, never displayed, and the drift-checker has no trigger, sim control manifest single source

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (2): Bug 18: the card-feature fallback ladder triggers on a substring match of an English Stripe error string — a reword would expire every hold on every ineligible account in one nightly pass, stripe client card feature ineligibility

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (2): Verified fact: refresh-deposit-holds is pg_cron jobid 57 at 0 3 * * *, active with 56 succeeded runs — but 'succeeded' only means pg_net dispatched the request, refresh deposit holds cron runs heartbeat

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (2): add payment dialog stripecheckoutlink, Mislabel: the portal's 'Charge via Stripe' button does not charge — it opens a Checkout URL and should be renamed 'Send payment link'

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (2): deduct from deposit deduct, V4: deduct-from-deposit labels operator-initiated deductions with Stripe reason 'requested_by_customer' — a bad fact in every dispute file

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (2): Idempotent tenant population script for branding, CMS, locations and extras, tenant onboarding canonicalpath

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (2): 86 audited edge cases documented in GMT_CHAINED_HOLD_SPEC.md, gmt chained hold critic capture paths broken

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (2): 20260605140000 trax price suggest utilisation nudge, Investigate external pricing data sources (Red Scout, PriceLabs); only weather is used today

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (1): M3: is_recurring can save true with a null recurrence_interval (the select only displays the default)

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (1): Role-based landing route after login (ops to vehicles, viewer to reports)

## Ambiguous Edges - Review These
- `Multi-tenant isolation: every business table carries tenant_id and is filtered by RLS` → `Cross-domain seam critique of the chained-hold designs: every finding lives between two domains that each read only half the code`  [AMBIGUOUS]
  docs/GMT_CHAINED_HOLD_CRITIC.md · relation: references
- `Per-integration live-ready rules (Stripe, BoldSign, Bonzah, Subscription, Modives)` → `tenants.stripe_platform_account ('uk' | 'ae') — per-tenant platform-account routing`  [AMBIGUOUS]
  docs/STRIPE_UAE_MIGRATION_CHECKLIST.md · relation: conceptually_related_to
- `Stripe Connect production go-live checklist` → `Two-provider Finance Sync module (Xero + Zoho Books)`  [AMBIGUOUS]
  docs/XERO_ZOHO_FINANCE_SYNC_GUIDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **340 isolated node(s):** `Tenant Twilio SMS toggle gates the public compliance pages`, `Approved Twilio Brand (EIN and address matching IRS records) is a hard precondition`, `Sample messages must carry the brand name and STOP language`, `Campaign must declare embedded payment/e-sign links and phone numbers`, `Four Resend senders lack an unset-guard and hard-fail mid-scenario with Bearer undefined` (+335 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 40`** (2 nodes): `L1: no pagination — the whole tenant's expense set is loaded, then searched and reduced in memory`, `CSV export deliberately exports only the filtered in-memory view — a pagination change would silently truncate it`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `accrue payg charges cronjob`, `Roadmap: make the recurring toggle real via a cron job reusing the PAYG / auto-extension cron pattern`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `Major 10: one-way transitions (auto_extend_paused, plan overdue, collection_mode='manual') can kill a fixture in one click — mark them irreversible in the manifest`, `Minor 17: Stripe Sandbox delivers delayed events for up to 7 real days, so fixtures are same-day disposable and teardown must cancel its own PIs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `Bug 11: sync-deposit-hold rewrites rentals.platform_account unconditionally from the tenant's current model, so a browser redirect can re-anchor a UK rental to UAE`, `sync deposit hold platform anchor guard`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `create preauth checkout bookingpreauth`, `Bug 21: two different things are both called a 'deposit hold' — booking pre-auths carry a payments row, rental deposit holds do not, so any merged reporting double-counts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `EC-24 Pending-rental holds are released, never chained`, `Rationale: re-authorizing a card every five days for an uncollected car is indefensible under 5.7.2.4 - release Pending holds instead of chaining them`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `charge-deposit-dialog.tsx (operator capture UI, locked to a full capture)`, `EC-38/39 partial capture re-enabled, bounded by selected charges, with a claim + idempotency key`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `Subdomain to tenant resolution via the x-tenant-slug header`, `middleware portaltenantresolution`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `manage subscription plans stripepricelifecycle`, `Saving a plan also creates the Stripe Price object`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `capture booking payment buffertimeadvisory`, `Duplicate-request cooldown (~30 min) to block accidental double-booking`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `Two competing verification codes caused permanent 'Invalid Passcode' at signup`, `Single-source OTP for account creation (platform-wide fix)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `ai document ocr index ts`, `Roadmap: reuse the existing ai-document-ocr function to autofill vendor/amount/date from a receipt`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `Major 13 / prod bug: daily-reminders buckets are exact midnight-UTC floor math, so the 'due today' bucket is unreachable after 00:00 UTC`, `daily reminders reminderschedule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `Major 11: anti-rot triple gap — staleness stamped at sync not deploy, never displayed, and the drift-checker has no trigger`, `sim control manifest single source`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `Bug 18: the card-feature fallback ladder triggers on a substring match of an English Stripe error string — a reword would expire every hold on every ineligible account in one nightly pass`, `stripe client card feature ineligibility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `Verified fact: refresh-deposit-holds is pg_cron jobid 57 at 0 3 * * *, active with 56 succeeded runs — but 'succeeded' only means pg_net dispatched the request`, `refresh deposit holds cron runs heartbeat`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `add payment dialog stripecheckoutlink`, `Mislabel: the portal's 'Charge via Stripe' button does not charge — it opens a Checkout URL and should be renamed 'Send payment link'`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `deduct from deposit deduct`, `V4: deduct-from-deposit labels operator-initiated deductions with Stripe reason 'requested_by_customer' — a bad fact in every dispute file`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `Idempotent tenant population script for branding, CMS, locations and extras`, `tenant onboarding canonicalpath`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `86 audited edge cases documented in GMT_CHAINED_HOLD_SPEC.md`, `gmt chained hold critic capture paths broken`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `20260605140000 trax price suggest utilisation nudge`, `Investigate external pricing data sources (Red Scout, PriceLabs); only weather is used today`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `M3: is_recurring can save true with a null recurrence_interval (the select only displays the default)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `Role-based landing route after login (ops to vehicles, viewer to reports)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Multi-tenant isolation: every business table carries tenant_id and is filtered by RLS` and `Cross-domain seam critique of the chained-hold designs: every finding lives between two domains that each read only half the code`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Per-integration live-ready rules (Stripe, BoldSign, Bonzah, Subscription, Modives)` and `tenants.stripe_platform_account ('uk' | 'ae') — per-tenant platform-account routing`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Stripe Connect production go-live checklist` and `Two-provider Finance Sync module (Xero + Zoho Books)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `tenants table` connect `Community 3` to `Community 8`, `Community 16`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `rentals table` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `The unjoined file: flipPaymentModel nulls stripe_customer_id for EVERY customer of the tenant, justified in-code by a readiness gate whose premise is false three times over` connect `Community 16` to `Community 3`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `leads table — the pre-rental opportunity record replacing enquiries` (e.g. with `Apply form Zod schema — one master schema shared by client steps and server validation` and `Lead scoring — lead_score 0-100 plus hot/warm/cold/risk band with score_reason`) actually correct?**
  _`leads table — the pre-rental opportunity record replacing enquiries` has 5 INFERRED edges - model-reasoned connections that need verification._