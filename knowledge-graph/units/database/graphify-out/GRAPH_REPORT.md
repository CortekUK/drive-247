# Graph Report - database  (2026-09-04)

## Corpus Check
- 391 files · ~180,649 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1491 nodes · 2066 edges · 34 communities detected
- Extraction: 77% EXTRACTED · 22% INFERRED · 1% AMBIGUOUS · INFERRED: 464 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `tbl tenants` - 60 edges
2. `tbl rentals` - 48 edges
3. `tbl ledger entries` - 24 edges
4. `One RPC returns every portal tab's headline metrics for a tenant, so the AI assistant can answer numeric questions without table access` - 23 edges
5. `tbl vehicles` - 21 edges
6. `tbl app users` - 18 edges
7. `rentals` - 16 edges
8. `delete_rental_cascade: hand-written SECURITY DEFINER teardown of a rental and every dependent row, ending by releasing the vehicle back to Available` - 15 edges
9. `Single-call customer 360 aggregate assembled for the Trax AI assistant` - 15 edges
10. `tbl customers` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Per-tenant Stripe test/live mode switch` --semantically_similar_to--> `Per-tenant INSHUR credentials and mode configuration`  [INFERRED] [semantically similar]
  MANUAL_MIGRATION.sql → docs/INSHUR_SCHEMA.sql
- `Rationale: kept out of supabase/migrations because the migrations folder is a known-inaccurate map of live state` --semantically_similar_to--> `Rationale: applied by hand in the Supabase SQL editor, not by db push`  [INFERRED] [semantically similar]
  docs/GMT_HOLD_SCHEMA.sql → MANUAL_MIGRATION.sql
- `INSHUR / ABI Period Z rental insurance integration` --semantically_similar_to--> `Per-tenant third-party integration feature flags (Canopy, Veriff, Bonzah)`  [INFERRED] [semantically similar]
  docs/INSHUR_SCHEMA.sql → supabase/migrations/20260103130000_add_tenant_integrations.sql
- `Partial unique index as the only double-bind guard (ABI has no idempotency key)` --semantically_similar_to--> `Idempotent one-charge-per-rental-per-due-date ledger upsert`  [INFERRED] [semantically similar]
  docs/INSHUR_SCHEMA.sql → supabase/migrations/20251222220000_fix_tenant_id_in_ledger_functions.sql
- `Private inshur-id-cards storage bucket served via signed URLs` --semantically_similar_to--> `Customer documents bucket is public with unauthenticated INSERT and SELECT`  [INFERRED] [semantically similar]
  docs/INSHUR_SCHEMA.sql → supabase/migrations/20251222200000_create_customer_documents_bucket.sql

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (135): App-user visibility rule: self, own-tenant admins, super admins, Rationale: three overlapping SELECT policies caused unexpected behaviour, so they were folded into one, Pattern: RLS-by-iteration - policies rewritten wholesale in successive migrations rather than amended, Rationale: policy simplified 'to avoid function call issues' - a policy on app_users that queries app_users needs SECURITY DEFINER to escape recursion, SECURITY DEFINER self-join escape hatch for app_users RLS, Decision: the SECURITY DEFINER helper was dropped one hour later, reverting to get_user_tenant_id + get_user_role, Rationale: 'logged-in users might have a different tenant_id than the tenant they're viewing' (super-admin tenant impersonation), Ledger rows with NULL tenant_id are readable by everyone (+127 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (103): Tenant business-hours gate on booking, Timezone-aware booking: customer picks times in their own IANA timezone, validated against tenant business hours, Gotcha: the 21 per-day hour columns coexist with the earlier global working_hours_open/close columns and nothing reconciles the two models, Per-weekday opening hours schedule (weekends off by default), Customer-requested rental extension with a pending-approval state, Gotcha: previous_end_date holds the REQUESTED new end date while the request is pending and the ORIGINAL end date after approval - its meaning flips with is_extended, Rental renewal chain: a new rental links back to the rental it was renewed from, The extension checkout URL is parked on the rental so a pending extension payment link can be re-shown or re-sent (+95 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (95): 20251222100000 add pickup location settings publiclocationread, Per-tenant tax rate applied to rentals, Per-tenant fixed service fee on rentals, Security deposit resolution: global tenant amount vs per-vehicle amount, Invoice snapshots the service fee and security deposit charged, Radius-based pickup/return area around the customer's live location, Rationale: the pickup/return mode CHECK constraints are located by pg_constraint name LIKE search because their generated names differ between environments, Rationale: tenants that already completed Stripe Connect onboarding are assumed live and backfilled, everyone else defaults to test for safety (+87 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (93): Reporting views are granted to anon and carry no RLS of their own, Per-vehicle profit and loss reporting, Rationale: views lacking tenant_id returned 400 Bad Request when the portal filtered by tenant, Automatic CMS page provisioning on tenant creation, Canonical marketing-site page set (home, about, contact, fleet, reviews, promotions, terms, privacy) seeded as draft, Receivables ageing buckets (0-30/31-60/61-90/90+) over open ledger charges, Tenant-scoped export/reporting view layer, Ledger entry type matched case-inconsistently ('charge' in rentals export, 'Charge' in ageing) (+85 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (93): Dual test/live credit balance tracking on tenant wallets, Rationale: credit functions are CREATE OR REPLACE applied via apply_migration, not tracked in this file, tenant_credit_wallets (per-tenant prepaid credit wallet), Rationale: Bonzah caps a single policy at 30 days, so a longer rental needs sequential policies sharing one chain_id, bonzah_insurance_policies (issued insurance cover per rental), Bonzah insurance policy chaining for long rentals, Messaging provider secrets (Twilio auth token, Meta access token) live as plain tenant columns, Per-tenant Twilio subaccount and phone number provisioning (+85 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (88): 20251219150000 fix view pl by vehicle tenant id pervehiclepl, 20260113150000 add customer profile photo bucket ownership gap, Pattern: adding one ledger category means dropping and recreating the whole CHECK with the complete list repeated, carrying forward legacy duplicates such as 'InitialFee' and 'Initial Fees', Extension charges become a first-class ledger category, Granular per-tab access control - the manager is the only role whose access is not a fixed level, Gotcha: the table carries no tenant_id - tenant scoping exists only through the join to app_users, so every cross-tenant guarantee depends on that join, Design: only service_role may INSERT/UPDATE/DELETE, so grants can only change through an edge function and never straight from the portal client, Three stacked SELECT policies: a user reads their own grants, a head_admin reads their tenant's users' grants, a super admin reads all (+80 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (86): Exactly one active agreement template per tenant (partial unique index), Four coexisting generations of the allocation algorithm, Unique constraints are the idempotency mechanism for money postings, Anonymous pre-signup verification claim is one-way (NULL customer_id can only be filled, never re-pointed), app_login - bcrypt username/password login against a users table not in this schema, app_users - portal staff, their role and tenant binding, apply_payment - legacy allocator against the retired payments.type/status model, apply_payment_fully - allocator that also generates the next charge when credit remains (+78 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (79): Gotcha: the aggregate selects FROM bonzah_policies while the insurance table defined in the schema is bonzah_insurance_policies, Single-call customer 360 aggregate assembled for the Trax AI assistant, Legacy naming: agreements are surfaced to the assistant with a docusign_status field although e-signature runs on BoldSign, Rationale: no chat messages are stored server-side - conversation history is kept in client memory only, Insufficient-balance payment status (applied out-of-band, never in a repo migration), Gotcha: this repo ships stub migrations - the live schema, not supabase/migrations/, is the source of truth, Customer-ledger charge category taxonomy (what a line on a customer's balance can be), Gotcha: singular/plural aliases ('InitialFee' vs 'Initial Fees', 'Fine' vs 'Fines') are both still legal - historical rows force it (+71 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (79): Per-tenant customizable customer-facing email templates (template_key registry), Tenant-isolation RLS convention: every row gated on tenant_id = get_user_tenant_id(), Idempotent reconciliation of a live table whose columns drifted from the code (body/name/category to template_content/template_name/template_key), Rationale: every ALTER wrapped in an information_schema existence check because the deployed table shape was unknown/partially migrated, Destructive gotcha: silently DELETEs duplicate (tenant_id, template_key) rows to make the unique constraint addable, Legacy email_templates columns retained but made nullable so new code never has to write them, Catalog-driven policy reset: loop pg_policies and DROP every policy on the table before recreating, Canonical tenant-isolation shape: one FOR ALL policy TO authenticated with get_user_tenant_id() OR is_super_admin() (+71 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (72): Logged outreach history drives the adaptive suggested message, Onboarding outreach follow-up log, Daily onboarding digest recipients + Bonzah contact, Manual checklist rows vs computed onboarding items, security_invoker view leans on tenants RLS for per-tenant scoping, Per-tenant onboarding status rollup (v_tenant_onboarding_status), A live Bonzah integration implies the application step for legacy operators, Branding completion is proxied by the paywall existing (+64 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (70): Public customer-photos storage bucket for profile pictures, Gotcha: the 'own profile photo' storage policies only test auth.role() = 'authenticated', so any signed-in user can overwrite or delete any customer's photo, Fix: app_users is keyed by auth_user_id, not user_id, so the caller lookup silently found nobody, Every block/unblock writes a BLOCK_CUSTOMER / UNBLOCK_CUSTOMER audit_logs entry, Blocking a customer propagates to the identity blocklist across licence number, ID number and Veriff document number, Veriff document_type is mapped by substring match to passport / license / id_card blocklist types, Super admins (is_super_admin true / tenant_id NULL) bypass the tenant check in block and unblock, Throwaway debug_unblock_customer probe that dumps caller vs customer tenant state to diagnose the access-denied loop (+62 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (65): Super-admin cross-tenant email template authoring, Rationale: a combined tenant-isolation policy blocked super-admin INSERTs because WITH CHECK did not repeat the is_super_admin() test, so the policy was split per operation, Rationale: the policy on app_users must call SECURITY DEFINER helpers, because reading app_users inside its own policy triggers a recursive RLS check that made new users invisible in Manage Users, Tenant head_admins and admins can list every user in their own tenant, Duplicate migration: 120001 re-applies the identical app_users policy body one minute later, Gotcha: p_tenant_id is accepted but never used in any WHERE clause - every lookup filters on customer_id alone on the stated assumption that customer_id is globally unique, Row Level Security switched off on the rentals table, Blanket RLS disable looped over every table in the public schema (+57 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (64): Per-vehicle monthly mileage allowance (NULL means unlimited), Rationale: all three toggles default true so every pre-existing vehicle stays fully bookable, Per-vehicle opt-out of the daily / weekly / monthly booking durations, Weekend and holiday surcharge pricing configured per tenant, A holiday can exclude vehicles inline via excluded_vehicle_ids, duplicating what vehicle_pricing_overrides 'excluded' also expresses, Gotcha: the FOR ALL 'manage' policies specify USING but no WITH CHECK, so inserts/updates are not re-validated against the tenant predicate, vehicle_pricing_overrides has no tenant_id - its RLS derives tenancy by joining to vehicles, so a vehicle row move silently re-homes the override, Per-vehicle override of a weekend or holiday rule: fixed price, custom percent, or excluded (+56 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (54): Operator choices: charge the first installment at checkout, and what portion of the cost gets split, Rationale: mark_installment_failed used to hardcode 3 retries and a 3-day grace period; it now reads the owning plan's config with those same numbers as COALESCE fallbacks so existing plans behave identically, Per-plan dunning policy: grace period, max retry attempts and retry interval held in a JSONB config, Retry-eligibility selection: which failed installments may be charged again, and how soon, Rationale: tenant installment_config is upgraded by JSONB merge guarded on NOT (config ? 'grace_period_days'), so operator-tuned settings survive and already-migrated tenants are skipped, Gotcha: comments and columns still say DocuSign although the e-signature provider is BoldSign (see rentals.docusign_envelope_id), The ALTER PUBLICATION is wrapped in a pg_publication_tables existence check so the migration is safe to re-run, Rentals are published to supabase_realtime so signing/status changes reach open portal and booking screens without a refetch (+46 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (49): Extension Rental recognised as owner-attributable revenue, Owners of extended vehicles saw $0 revenue (GMT, Jul 2026), Only the rental slice is owner-attributable; tax/service fee/insurance excluded, per_day vehicles must surface in windows that collected no cash, Revenue already snapshotted in overlapping payouts is netted off, Gross owner revenue stays cash-basis deliberately, Distinct calendar-day spine avoids double-counting overlapping rentals, Per-day flat-fee owner commission (+41 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (42): 20260212100000 add tenant subscriptions platform billing, 20260213100000 add setup completed at go live tracking, 20260218100000 add policy acceptances staffpolicyconsent, 20260410120200 add payg reminder cron job rationalehourlyfortimezones, 20260415120000 fix payg audit issues cronauthhardening, 20260629130000 add own stripe uae migration payment model, 20260629130000 add own stripe uae migration subscription account split, 20260708160000 simplify onboarding checklist threecheckpoints (+34 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (37): Rationale: upfront_monthly rides Stripe's trial primitive mechanically but is never presented to the customer as a free trial, upfront_monthly plan billing model: card taken at a hard gate, first charge one calendar month later, Rationale: with delivery_tiers_enabled false the existing flat area_delivery_fee still applies, so the change is behaviour-neutral, Rationale: bands stored canonically in kilometres to match pickup_area_radius_km / return_area_radius_km even though operators quote miles, Resolver picks the first band where distance <= up_to_km; a trailing null band is open-ended, otherwise the address is out of range, Distance-banded delivery fees for area delivery mode, Rationale: the kill-switch only hides the blocking dialog; subscription status, plans and billing are untouched, Global super-admin kill-switch hiding the subscription/setup blocker for every tenant (+29 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (36): Customer auth bridge: auth.users to customer_users to customers, In-app customer notification feed with unread index, Customer-scoped RLS: rentals and identity verifications readable through an EXISTS join on customer_users, Gotcha: the policies named 'Service role can insert' are WITH CHECK (true) with no TO role clause, so they do not actually restrict inserts to service_role, One auth user per customer login, one customer identity per tenant, Customers may update their own customers row from the booking portal, Token-and-expiry customer email change verification, Customer-scoped read access via rentals to customer_users to auth.uid() (+28 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (28): Every tenant is guaranteed one active template: 'Default Template' is preferred, otherwise the most recently updated row is activated, Rationale: duplicates were produced by race conditions in the template initialisation logic; a unique index on (tenant_id, template_name) makes the race harmless from now on, One-off data repair: dedupe agreement templates per tenant and template name, 20260415120000 fix payg audit issues paygledgerdedupeindex, Rationale: the old index allowed only one active template per tenant across all categories, so a PAYG template could not coexist with the standard one, Active-template and template-name uniqueness re-scoped per (tenant, template_category), Rationale: an expression index cannot back a table-level constraint, so ON CONFLICT ON CONSTRAINT stopped resolving, First rental charge split into per-category ledger rows from the invoice breakdown (+20 more)

### Community 19 - "Community 19"
Cohesion: 0.1
Nodes (26): Revenue booked into pnl_entries on the charge due date at allocation time, even for future dates, Gotcha: the insurance-verifications bucket is created public=true, so object URLs are readable regardless of the tenant-scoped SELECT policy, Tenant-folder-prefix storage isolation ((storage.foldername(name))[1] = tenant id) for insurance uploads, Per-tenant custom expense categories mapping a category name to a P&L bucket (Service vs Expenses), Expense Tracker: vehicle costs and business-wide overhead in one ledger with vendor, payment method, receipt and recurrence, NULL vehicle_id means a company-wide/overhead expense; a set vehicle_id means a vehicle cost (and only then a vehicle_event is logged), Expense-to-P&L sync keyed by reference 'vexp:{expense_id}' (bucket resolved from the tenant's category config, legacy hardcoded fallback), Rationale: pnl_entries.tenant_id backfilled from the linked vehicle — vehicle-expense P&L rows were silently excluded from tenant-scoped summaries (+18 more)

### Community 20 - "Community 20"
Cohesion: 0.1
Nodes (25): Rationale: chat_channels is published alongside the message table so channel-level metadata such as last_message_at also propagates live, Chat delivery moves from a Socket.io server to the Supabase Realtime publication, Rationale: chat_channels.last_channel records the last medium used so replies default to that channel, Multi-channel messaging: SMS/WhatsApp/email carried on the in-app chat tables, Twilio delivery-status webhook audit trail, Lockbox send audit log (scheduled / sent / resent / rescheduled / failed) per delivery channel, Gotcha: the 'Service role can manage' policy carries no TO clause, so USING(true) grants every role full write access, The reset also writes a 'rescheduled' audit row carrying the old and new pickup window (+17 more)

### Community 21 - "Community 21"
Cohesion: 0.1
Nodes (22): Per-rental accrual cursor: start anchor, last/next accrual timestamps, day count, pause and close stamps, UNIQUE(rental_id, accrual_day_index) makes cron double-posting structurally impossible, Partial indexes scoped to open PAYG rentals are the scan path for both the accrual and reminder crons, Pay-As-You-Go rental billing foundation: tenant policy, per-rental state and accrual bookkeeping, Per-rental reminder interval override; NULL falls back to the tenant default, Gotcha: the cron indexes filter on rentals.is_pay_as_you_go, a column this migration never creates, Rationale: PAYG reuses the existing Rental / Tax / Service Fee ledger categories, so no CHECK constraint change was needed, Rationale: SELECT-only tenant RLS with no write policy at all, because edge functions use service_role and bypass RLS (+14 more)

### Community 22 - "Community 22"
Cohesion: 0.19
Nodes (13): Duration-based promo codes that auto-apply to fixed rentals lasting at least N days, Rationale: auto-apply is deliberately excluded from installment plans, PAYG and auto-extend renewal cycles, Highest qualifying duration tier wins when several codes match the rental length, Backfill keeps duration codes advertised on the public promotions page after the merge, Promotions merged into promo codes: each code carries its own marketing card and public-page flag, Gotcha: a global UNIQUE(code) let one tenant's OFF20 block every other tenant, surfacing as a duplicate-key error on a code the operator did not have, Promo-code uniqueness rescoped from global to per-tenant, Consequence: the DROP discards any marketing copy and banner URLs operators authored during the three-day merge window (+5 more)

### Community 23 - "Community 23"
Cohesion: 0.52
Nodes (7): contact_requests.fleet_size lead qualifier, strategy_call_emails table, Strategy-call email sequence state machine (confirmation, reminders, attended/noshow followups), contact_requests phone and challenge qualifiers for the strategy-call form, contact_requests budget and readiness qualifiers for the strategy-call form, tbl contact requests, tbl strategy call emails

### Community 24 - "Community 24"
Cohesion: 0.4
Nodes (5): rental_additional_drivers added to the supabase_realtime publication, Gotcha: the additional-drivers card subscribed to realtime but the table was never published, so verification/signing badges only refreshed on page load, boldsign-webhook edge function, rental_additional_drivers table, veriff-webhook edge function

### Community 25 - "Community 25"
Cohesion: 0.5
Nodes (4): Case-insensitive recipient uniqueness so Ops@ and ops@ cannot double-mail the same person, notified_at stamp makes the feedback alert mailer idempotent against retries, double-clicks and replayed requests, notify-feedback-submission alert mailer, tbl tenant feedback recipients

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (3): Gotcha: add_credits folds 'gift' into lifetime_purchased alongside real purchases, so that column overstates revenue, add_credits creates the wallet on demand, so tenants never need an explicit provisioning step - but deduct_credits does not, and fails closed instead, fn add credits

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (3): The ABSENT INSERT policy on tenant_feedback_insights is the control that stops a browser forging an 'AI summary', feedback-insights AI summariser (service-role writer), tbl tenant feedback insights

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (3): insurance_policies - customer/vehicle cover with derived expiry status, Insurance policy expiry status recalculation and overlap detection, recalculate_insurance_status - derives Active/ExpiringSoon/Expired from dates

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (3): 20251219160000 auto seed cms pages for new tenant cmspageseeding, A 'blog' CMS page added to the new-tenant seed function and backfilled for existing tenants, tbl cms pages

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (2): is_partial and hours_covered carry the pro-rated final day when an admin closes a rental mid-cycle, finalize payg rental prorated partial day

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (2): Safety cap: accrual halts and an admin alert fires after payg_max_duration_days, deduped by payg_max_duration_alerted, accrue payg charges max duration alert

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (2): Structurally enforced singleton settings row (UNIQUE CHECKed boolean) so a second config the app never reads cannot exist, tbl tenant feedback settings

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (1): Staff profile avatar on app_users

## Ambiguous Edges - Review These
- `Reporting views are granted to anon and carry no RLS of their own` → `Super-admin cross-tenant bypass applied uniformly to rentals, vehicles, customers, payments, fines and blocked_identities`  [AMBIGUOUS]
  supabase/migrations/20251219150000_fix_view_pl_by_vehicle_tenant_id.sql · relation: conceptually_related_to
- `block_customer/unblock_customer resolve the caller via app_users.user_id while the RLS helpers use auth_user_id` → `is_super_admin() and get_user_tenant_id() as the tenant-isolation primitives`  [AMBIGUOUS]
  supabase/migrations/20251222100001_fix_blocking_rls_and_functions.sql · relation: conceptually_related_to
- `Any authenticated user - including tenant staff - can read and update platform admin settings` → `is_super_admin() and get_user_tenant_id() as the tenant-isolation primitives`  [AMBIGUOUS]
  supabase/migrations/20251222120000_add_admin_settings.sql · relation: conceptually_related_to
- `Align portal-created rentals with the customer booking flow's fields` → `Second, constraint-free definition of rentals.insurance_status with a different value vocabulary`  [AMBIGUOUS]
  supabase/migrations/20251222230000_add_insurance_status_to_rentals.sql · relation: conceptually_related_to
- `Per-tenant minimum renter age policy` → `Minimum-age constraint dropped and recreated with an identical predicate`  [AMBIGUOUS]
  supabase/migrations/20260103150000_update_minimum_age_to_16.sql · relation: governs
- `Staff AI assistant transcript with cited sources and renderable chart_data` → `Suspected defect: RAG/chat policies match app_users.id = auth.uid(), while every other tenant policy uses app_users.auth_user_id`  [AMBIGUOUS]
  supabase/migrations/20260121110000_add_rag_chatbot_tables.sql · relation: conceptually_related_to
- `Stub: invoice breakdown columns were applied straight to the remote database, no DDL is committed` → `tbl invoices`  [AMBIGUOUS]
  supabase/migrations/20260214110000_add_invoice_breakdown_columns.sql · relation: writes_table
- `Stub: the excess-mileage charge category was applied straight to the remote database` → `tbl ledger entries`  [AMBIGUOUS]
  supabase/migrations/20260214120000_add_excess_mileage_category.sql · relation: writes_table
- `Stub: customer address fields were applied straight to the remote database` → `tbl customers`  [AMBIGUOUS]
  supabase/migrations/20260214130000_add_customer_address_fields.sql · relation: writes_table
- `Dual test/live credit balance tracking on tenant wallets` → `Bonzah insurance policy chaining for long rentals`  [AMBIGUOUS]
  supabase/migrations/20260305170000_add_test_balance_to_credit_wallets.sql · relation: conceptually_related_to
- `Rationale: a NULL offset means manual-only send and 0 means exactly at start time` → `Ambiguity: the tenant setting is documented as minutes before rental start, yet the cron comment describes approved_at + offset`  [AMBIGUOUS]
  supabase/migrations/20260407120001_add_lockbox_cron_job.sql · relation: conceptually_related_to
- `Rationale: approval time (not booking time) is the anchor for lockbox auto-send timing` → `Ambiguity: the tenant setting is documented as minutes before rental start, yet the cron comment describes approved_at + offset`  [AMBIGUOUS]
  supabase/migrations/20260407120001_add_lockbox_cron_job.sql · relation: conceptually_related_to
- `extension_id linkage stamped on ledger, payments and insurance rows` → `Bonzah policies and payments matched to extensions by rental plus chronological row order`  [AMBIGUOUS]
  supabase/migrations/20260417120000_add_rental_extensions_table.sql · relation: conceptually_related_to

## Knowledge Gaps
- **556 isolated node(s):** `Rationale: re-deriving Stripe context from the current tenant row breaks in-flight holds during the UK to UAE migration`, `Hold expiry provenance and granted authorization window`, `Rationale: debit stacking is the main renter-harm risk on a hold chain, so card funding must be detectable`, `Rationale: the link row is written BEFORE the Stripe call so a crashed attempt stays discoverable`, `Rationale: a heartbeat table distinguishes "no alerts" from "the cron job is dead"` (+551 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 30`** (2 nodes): `is_partial and hours_covered carry the pro-rated final day when an admin closes a rental mid-cycle`, `finalize payg rental prorated partial day`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `Safety cap: accrual halts and an admin alert fires after payg_max_duration_days, deduped by payg_max_duration_alerted`, `accrue payg charges max duration alert`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `Structurally enforced singleton settings row (UNIQUE CHECKed boolean) so a second config the app never reads cannot exist`, `tbl tenant feedback settings`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `Staff profile avatar on app_users`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Reporting views are granted to anon and carry no RLS of their own` and `Super-admin cross-tenant bypass applied uniformly to rentals, vehicles, customers, payments, fines and blocked_identities`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `block_customer/unblock_customer resolve the caller via app_users.user_id while the RLS helpers use auth_user_id` and `is_super_admin() and get_user_tenant_id() as the tenant-isolation primitives`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Any authenticated user - including tenant staff - can read and update platform admin settings` and `is_super_admin() and get_user_tenant_id() as the tenant-isolation primitives`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Align portal-created rentals with the customer booking flow's fields` and `Second, constraint-free definition of rentals.insurance_status with a different value vocabulary`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Per-tenant minimum renter age policy` and `Minimum-age constraint dropped and recreated with an identical predicate`?**
  _Edge tagged AMBIGUOUS (relation: governs) - confidence is low._
- **What is the exact relationship between `Staff AI assistant transcript with cited sources and renderable chart_data` and `Suspected defect: RAG/chat policies match app_users.id = auth.uid(), while every other tenant policy uses app_users.auth_user_id`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Stub: invoice breakdown columns were applied straight to the remote database, no DDL is committed` and `tbl invoices`?**
  _Edge tagged AMBIGUOUS (relation: writes_table) - confidence is low._