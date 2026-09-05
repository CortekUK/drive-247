# Graph Report - edge-functions  (2026-09-04)

## Corpus Check
- 405 files · ~584,685 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3742 nodes · 6634 edges · 86 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 813 edges (avg confidence: 0.82)
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
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]

## God Nodes (most connected - your core abstractions)
1. `tenants table` - 113 edges
2. `rentals table` - 84 edges
3. `tenants table` - 52 edges
4. `json()` - 50 edges
5. `app_users table` - 47 edges
6. `payments table` - 47 edges
7. `customers table` - 35 edges
8. `jsonResponse()` - 28 edges
9. `ledger_entries table` - 27 edges
10. `formatCurrency()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `Admin email: booking pre-authorization expiring, approve or reject before the hold is auto-released` --semantically_similar_to--> `Branded HTML email shell using the tenant's logo, primary and accent colours`  [INFERRED] [semantically similar]
  supabase/functions/_shared/email-templates/admin-expiry-warning.html → supabase/functions/_shared/email-template-service.ts
- `Runtime-generated branded header and footer built from tenant colours and logo` --semantically_similar_to--> `Static templates hardcode DRIVE 247 branding and support@drive-247.com`  [INFERRED] [semantically similar]
  supabase/functions/_shared/resend-service.ts → supabase/functions/_shared/email-templates/booking-approved.html
- `Tenant currency formatting for edge-function-generated documents` --semantically_similar_to--> `Byte-for-byte-adjacent formatting helper duplicated in portal and booking`  [INFERRED] [semantically similar]
  supabase/functions/_shared/format-utils.ts → apps/portal/src/lib/format-utils.ts
- `Server-side manager tab-key whitelist (ALLOWED_TAB_KEYS)` --semantically_similar_to--> `Manager per-tab access control`  [INFERRED] [semantically similar]
  supabase/functions/admin-create-user/index.ts → apps/portal/src/lib/permissions.ts
- `A hardcoded ALLOWED_TAB_KEYS whitelist duplicating the portal's permission constants — the two must be edited together` --semantically_similar_to--> `Manager per-tab access control`  [INFERRED] [semantically similar]
  supabase/functions/update-manager-permissions/index.ts → apps/portal/src/lib/permissions.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (127): getSignatureKey(), hmacSha256(), isAWSConfigured(), parseXMLValue(), sha256(), signedAWSRequest(), toHex(), assertBonzahSellable() (+119 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (365): accept offer vehicle removed guard, accrue-payg-charges edge function (the production PAYG accrual cron), accrue payg charges catchup cap, PAYG daily charge accrual cron, sole writer of daily Rental/Tax/Service Fee, accrue payg charges hardcoded window bug, accrue payg charges idempotency, accrue payg charges payg accrual cron, accrue payg charges sandbox scoping (+357 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (328): Double-booking concurrency guard: re-check rental overlaps at acceptance time, Date-flex window validation against the offer's default dates, Lead stage transition to offer_accepted plus automation event and activity trail, Public lead-offer acceptance (customer picks vehicle and confirms dates), Vehicle-removed guard: surface vehicle_unavailable instead of an FK-violation 500, Rental-scoped ledger references (payg-{rental}-day-{n}-*) for global uniqueness and FIFO seniority, Already-active path still forces ledger allocation the webhook may have skipped, Stripe objects are pinned to payments.platform_account (uk/uae), not the tenant's current model (+320 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (165): activate installment plan platform pinning, Bonzah addendum is a tenant-level disclosure gated on tenants.integration_bonzah, never per-rental purchase, Splice above the EARLIEST signature marker, not the first matching pattern, Legacy {{vehicle_allowed_mileage}} check prevents stating the allowance twice in one contract, Render-time injection of mileage, T&C and Bonzah clauses into stored agreement templates, Byte-identical triplicate across portal, booking and the Deno edge function (three module resolvers), Why inject at render time instead of rewriting the operator's stored template row, Excess rate is a money term: currency_code and distance_unit come from the tenant, never hardcoded '$'/'miles' (+157 more)

### Community 4 - "Community 4"
Cohesion: 0.01
Nodes (162): Server-side manager tab-key whitelist (ALLOWED_TAB_KEYS), Manager permission sync: replace on promotion, purge on demotion, Compensating revert of the role when the permission insert fails, Tenant terms APPEND to built-in boilerplate; replacing would drop insurance/liability/governing-law clauses, Incorporate the tenant's own CMS Terms & Conditions into the signed rental agreement, Deliberately not filtered on cms_pages.status='published' — every section save resets it to draft, Strip script/style/on* handlers and escape non-HTML text before embedding CMS content in a contract, Super-admin-only authorisation gate (+154 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (151): call_logs table, applicantVerificationReqGuidId lives in result.applicants[0]; a top-level UUID fallback would grab the dealerGuid, Modives compliance: never persist carrier or policy data, only IDs, status enum and the link, Env-var and dealer_guid preflight returns an actionable 503 instead of a generic fetch 500, Magic link and a 7-day expiry are persisted specifically so the link can be re-sent later, Magic-link fan-out across email / SMS / WhatsApp channels, best-effort and non-fatal, Three-call Modives handshake: verification -> verification-detail -> consumer-magic-link, The Drive247 Modives account is configured not to auto-email consumers, so link delivery is entirely ours (+143 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (74): captureFetch(), checkoutBody(), idempotencyKeyFor(), stubSupabase(), capabilitiesFor(), isCountrySupported(), tryProviderCheckout(), WrongProviderError (+66 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (126): admin deactivate user signout ineffective, admin force logout decorative button bug, admin force logout rpc over direct pg, admin force logout session revocation, verify_jwt is satisfied by the PUBLIC anon key shipped in the booking bundle — why an explicit tenant guard runs before the rental fetch and before any Stripe call, The body's tenantId is a convenience hint for Stripe config only — it must never stand in for the rental's own tenant, capture-deposit-hold edge function, Expired-hold self-heal — reconcile the DB to 'expired' and return code hold_expired at HTTP 200 so the UI can switch to Refresh-then-Charge instead of showing a raw non-2xx error (+118 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (62): appCredsFor(), classify(), classifyFailure(), clean(), cleanOrNull(), composeAbiDateTime(), deleteAppUser(), deletePlanRow() (+54 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (98): Identity-document field extraction via GPT-4o vision, Supabase-storage-aware image fetch with chunked base64 encoding to avoid stack overflow, AWS error codes mapped to operator-actionable messages (bad keys, missing IAM permission, no face), Selfie-to-document face matching via AWS Rekognition CompareFaces, Hand-rolled AWS Signature V4 signing using Web Crypto (no AWS SDK in Deno), Three-tier verification outcome: >=90 match, 70-89 manual review, <70 no match, Pickup and return odometer readings come from the giving/receiving rental_key_handovers rows, not from the rental, Per-call OpenAI token and USD cost logging into openai_usage_logs, priced from an inlined model table (+90 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (115): accept offer offer acceptance, ai rank matches vehicle ranking, ai_call_logs kept separate from openai_usage_logs written by the shared helper, Post-hoc confidence dampening because GPT over-defaults to 0.9, conversation.id is not lead.id — the conversation row is resolved by lead_id, Stage-aware AI next-action proposer for sales leads, Tenant AI monthly quota with deterministic fallback, Five-minute payload-hash response cache in ai_call_logs (+107 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (86): Max-duration safety cap that halts accrual and raises a critical admin reminder, abiGetStates(), adoptRemoteOnly(), constantTimeEquals(), emitCancelFailureAlert(), envelope(), errorCodeOf(), errorMessageOf() (+78 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (91): Defence in depth: never trust client-supplied tenant scoping on a service-role write, Rollback of the auth user when the app_users profile insert fails, ilike narrows then JS compares exactly, so a legal underscore cannot wildcard-match another account, Only an active PRIMARY super admin may mint sales agents, Least-privilege sales agent: scope from is_sales_agent, role stays 'viewer', tenant_id NULL, Existing auth user re-linked to a different tenant instead of duplicated, Case-insensitive duplicate-profile guard so re-adding a person cannot fork their credentials, Store the lowercased address because GoTrue lowercases what it holds (+83 more)

### Community 13 - "Community 13"
Cohesion: 0.02
Nodes (99): Distinct cron_runs job_name per run shape so dead-man checks stay honest, amount_cents is the money that MOVED; what is still authorised lives in estimate_inputs.remaining_held — conflating them was the original leak, deposit_hold_links authorization ledger: upsert-as-latest, full column replacement, and genuinely best-effort, create-hold-checkout edge function — the portal 'Add Hold' Checkout-session path, An explicit 0 override means 'operator opted out of a hold', not 'unset', Per-vehicle deposit_mode honoured only for an explicit tenant allowlist (GMT) — widening changes real charges, place-deposit-hold edge function — the automatic/manual deposit authorisation path, Single source of truth for how much deposit to hold on a rental (+91 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (91): getCustomerIdForAccount(), failureClassGloss(), firstNumber(), firstString(), formatWhen(), lookupRentalNumber(), notifyDepositHoldChainEnded(), notifyDepositHoldConfigBlocked() (+83 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (93): Bill on the Stripe account recorded on the subscription row (uk/uae), duration:'once' Stripe coupon so billing auto-reverts with no cron or cleanup, One-time platform-subscription discount for a tenant, Delete the coupon if attaching it to the subscription fails, Never re-hold the remainder on an auto-extend rental (renewal pricing replaces the deposit); manual extensions were re-allowed after the GMT incident, Jul 2026, Multicapture path keeps the remainder on the SAME PI (final_capture:false); pre-rollout holds and multicapture rejections fall back to a fresh rollover PI, placeDepositHoldAfter chains place-deposit-hold over service-role HTTP, deliberately writing no deposit_hold_* state here — that state machine is owned by place-deposit-hold, validateStripeCustomerId runs first — a test-era customer id does not exist on the live Connect account (Kedic go-live incident: 12 blind retries because place-deposit-hold skips this check) (+85 more)

### Community 16 - "Community 16"
Cohesion: 0.03
Nodes (78): ai-document-ocr edge function, ai-face-match edge function, blocked_identities table, context.alerted latch stops re-notifying on every poll; recovery above the threshold resets the reminder to an info 'monitoring' state, Bonzah low-balance alerting: reminder row + per-admin in-app notification + branded email, Threshold/alerting errors are swallowed so a notification failure never fails the balance request, Two-phase AI action flow — the model's tool call becomes a proposal, the client confirms, and execute_action re-checks RBAC server-side before writing, Both turns are persisted to chat_messages with the retrieved sources and any chart payload attached to the assistant row (+70 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (74): Never settle an installment slot with a fee-targeted payment, Installment slot self-heal after allocation, Installment payment schedule rendered into the agreement from the rental's plan and scheduled rows, create checkout session capability, Back-compat shim translating legacy planType/baseUpfrontAmount into unit + paymentsPerUnit + upfrontFixedAmount, interval_days = (week 7 | month 30) / paymentsPerUnit, with a human frequency label stored in plan config, Installment plan creation plus a fees-and-first-installment Stripe Checkout session, Rounding remainder is soaked up by the final installment so the schedule always sums to the installable amount (+66 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (52): buildRentalTimeFacts(), buildTimeVariables(), formatDateOnly(), formatScheduledDateTime(), formatTimeOfDay(), formatZonedDate(), formatZonedDateTime(), isValidTimeZone() (+44 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (47): Tenant-scoped customer registration invite token with 7-day expiry, Invite URL convention: https://{tenantSlug}.drive-247.com/register/{token} on the booking app, archivePriceIfPresent(), bounce(), createdButNoCheckout(), errorResponse(), getCurrencySymbolLocal(), getOrCreateProduct() (+39 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (38): Veriff session + invite email are delegated to send-additional-driver-invite so the rental form can fire-and-forget, addPeriod(), allowedHosts(), applyExceptions(), authorized(), buildEmail(), buildEmailHtml(), button() (+30 more)

### Community 21 - "Community 21"
Cohesion: 0.04
Nodes (66): The always-on operator bell is tied to the newly-created reminder_event — this is the portal bell the reminder_events ledger never fed, Cron that generates monthly verification and expiry reminders for customer insurance policies, Expiry ladder fires at exactly 30, 14, 7 and 0 days before expiry, Policies past expiry are flipped Active to Expired; the source query only pulls Active, so the lapse alert fires exactly once, reminder_events.unique_key encodes policy + milestone; a 23505 duplicate is swallowed so repeat cron runs emit nothing, tenantId is taken from the request body with no membership check — unlike the billing functions that call authorizeTenantAccess, ABI permits Cancel only before the period begins; after that the call is switched to End and the response says so plainly, because they are not the same thing to an operator, Cancel INSHUR/ABI Period Z cover that has not started yet, falling back to End once it has (+58 more)

### Community 22 - "Community 22"
Cohesion: 0.06
Nodes (26): nextAttemptAfter(), getProvider(), createExtensionInvoice(), ensureContact(), ensureInvoiceWithLine(), findLatestInvoiceForRental(), findOpenInvoiceForRental(), flagConnectionExpired() (+18 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (52): 20260710120000 baseline bonzah onboarding plaintextcredentials, Correct answers live only behind service_role — RLS plus an answer-omitting view keep correct_option_index off the client, Grading normally runs BEFORE the submission row exists (client carries the result into its insert); submissionId is the re-grade path that stamps quiz_* + training_completed_at, Server-side Bonzah training-quiz grading (80% of active questions to pass), Approval writes an 'approved' (partner) + 'activated' (system) event pair so the console timeline shows who acted and what the system then did, Bonzah partner approve/reject of an operator's onboarding submission, Branded outcome emails are fire-and-forget (.catch(() => {})) — the review outcome is never blocked on mail delivery, Approval persists the operator's Bonzah username/password onto tenants and sets integration_bonzah = true (+44 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (50): Duplicate-charge guard: phantom Collection Fee / Insurance rows inflated Collected, A successful login deletes the recent failed attempts for that username, Rate limiter fails open for availability on internal error, Login-attempt rate limiting and lockout (5 per 10min, 15min lockout), Pre-selected Bonzah coverage is priced at renewal-creation time for the new period's dates, Per-occurrence renewal overrides: price, extras, insurance, email copy, Local Bonzah premium estimate (rate x 24-hour periods), Bonzah prices strictly per 24h with no multi-day discount, so estimate = rate x days (+42 more)

### Community 25 - "Community 25"
Cohesion: 0.04
Nodes (49): admin create user must change password, Platform email/SMS identity config — verified drive-247.com sender domain and admin fallbacks, AWS SigV4 request signing for SES and SNS from Deno edge functions, Translate AWS error codes into operator-actionable messages and never throw (degrade to 'nothing found'), Rekognition DetectText OCR used to locate number plates for photo redaction, Keep the rotated Polygon alongside the axis-aligned BoundingBox so a tilted plate is not clipped, SigV4 block lifted verbatim from ai-face-match — cosmetic edits silently break the signature, WORD-level detections only — a LINE box is a union and would black out the whole horizontal band (+41 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (39): detectText(), signAWSRequest(), Every attempt — succeeded, failed, requires_action, unrecorded — writes an audit_logs row carrying actor, card fingerprint fields and the duplicate override flag, The cleanup itself is recorded in audit_logs, best-effort so audit failure never fails the wipe, apps/portal useManagerPermissions().canEdit — the client-side answer this server guard is aligned to, Staff write-role matrix: head_admin/admin/ops allowed, manager needs an editor grant on the rentals tab, viewer refused, A read-only endpoint gated as tightly as a write, because every call costs real money at AWS, A Rekognition failure returns 502, never found:false, so users are not trained to trust an answer that was never computed (+31 more)

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (23): calculateRentalPriceBreakdown(), findMatchingHoliday(), formatDate(), getDayRate(), parseDateString(), date-fns-tz, blockBlocksQuoteWindow(), buildFleetQuote() (+15 more)

### Community 28 - "Community 28"
Cohesion: 0.1
Nodes (17): asRecord(), base64ToBytes(), constantTimeEqual(), customFieldValue(), isoDate(), mapEventType(), normalizeGhlBookingEvent(), pemToDer() (+9 more)

### Community 29 - "Community 29"
Cohesion: 0.14
Nodes (16): fineToDocument(), formatDate(), paymentToDocument(), plateToDocument(), rentalToDocument(), vehicleToDocument(), getCurrencySymbol(), rag_documents table (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (8): cmdFetch(), env(), getCMDToken(), getModivesAuthKey(), getModivesBaseUrl(), getModivesWebhookSecret(), getSubscriptionKey(), verifyWebhookSignature()

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (17): Accrual idempotency via UNIQUE(rental_id, accrual_day_index) — safe to re-run, Tenant-aware per-rental catch-up cap so one backdated rental cannot monopolise a run, Daily-rate formula must stay in lockstep with the portal's PAYG rate fallback, Historical over-accrual bug: hardcoded 5-minute window billed ~30 days in one burst, Pay-As-You-Go charge accrual (rental + tax + service fee per window), Per-tenant accrual window (payg_accrual_window_seconds; test tenant runs 5-minute days), only_rental_id sandbox scoping so a Time Machine dispatch can never touch other tenants, Known limitation: weekend/holiday surcharges are not applied to PAYG accruals (+9 more)

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (16): voicemail_recordings table, Rationale: answerOnBridge keeps the customer hearing ringback during the whisper, and is added ONLY in whisper mode to keep default behaviour unchanged, forwarding_caller_id_mode='business_line' shows the business number on staff phones instead of passing through the customer's, The <Dial> action URL carries tenantId/callSid/from/to/customerId/channelId into twilio-voicemail-handler when nobody answers in 30s, Rationale: in business_line mode the staff phone cannot resolve a contact name, so a whisper leg announces the caller before bridging, Whisper leg that announces the caller's name to the staff member only, then bridges the two parties, CNAM caller-name display is US-only, so a spoken announcement is the only carrier-independent way to convey the name internationally, A screened-declined call would dead-end the customer: the voicemail handler treats 'completed' as answered, so no business voicemail is offered (+8 more)

### Community 33 - "Community 33"
Cohesion: 0.23
Nodes (12): authorizeCaller(), base64urlDecode(), base64urlEncode(), base64UrlEncodeString(), createAccessToken(), ensureLiveApiKey(), signState(), timingSafeEqual() (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.4
Nodes (9): b64uToBytes(), bytesToB64u(), concat(), createVapidToken(), encryptPayload(), hkdf(), importVapidSigningKey(), sendWebPush() (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (3): childrenOf(), nextStepAfter(), rootOrderedSteps()

### Community 36 - "Community 36"
Cohesion: 0.25
Nodes (8): Charge-due reminder cadence: Upcoming at T-2 days, Due on the day, then Overdue1..5 at exactly 1, 7, 14, 21 and 28 days past due, With respect_credit_coverage on, a charge already covered by the customer's balance raises no reminder, Duplicate-key errors on reminder_events are swallowed: the unique constraint IS the idempotency mechanism for a job that may run more than once a day, This job only RECORDS reminder_events — the preview text says the customer will be notified 'once channels are connected', so no email/SMS leaves the system here, Every stage is individually switchable through the reminder_settings key/value table, with max_overdue_reminders capping the overdue ladder, reminder_events table, reminder_settings table, get_pending_charges_for_reminders() RPC

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (7): create sales onboarding provisioning, Sales strategy-call email sequence for inbound operator leads, Platform-level hardcoded brand block (UK Covent Garden address, placeholder unsubscribe URL, founder name, Calendly links) with TODOs to move to env, Documented gap: no scheduler is wired — reminders and follow-ups must be triggered externally once call_time is known, Idempotent send ledger: upsert on (contact_request_id, email_type) so a stage is recorded once, Five-stage sequence: confirmation, 24h reminder, 1h reminder, attended follow-up, no-show follow-up, strategy_call_emails table (sales sequence send ledger)

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (5): pnl_entries table, Every authority payment posts a matching P&L Cost entry in the Fines category, linked back to the fine through source_ref, A failed P&L insert never fails the request — the authority payment itself is the record of truth and the accounting entry is repaired separately, The P&L entry carries a unique reference of the form 'authority:<payment id>', so a duplicate key means the cost was already booked and is logged rather than treated as a failure, P&L revenue entries are removed with a LIKE match on source_ref prefixed by the payment id, which is the only link between a payment and its revenue rows

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): Bonzah / Insillion insurance API client (auth, fetch wrapper, coverage codes, quote & policy shapes), Bonzah auth token caching (14-minute TTL), per-username and legacy global, ZIP+4 makes Bonzah quote finalize return an empty payment_id with status 0 — strip to 5 digits

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (3): Free-text brand description to concrete tenant colour palette via OpenAI tool-call, Deterministic word/hex fallback so tenant provisioning is never blocked on the model, scripts/tenant-onboarding.mjs — the column mapping and dark-mode lightening ported verbatim from it

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (3): Mock branch runs before any network code so an outage cannot silently fake cover, Mock is a first-class mode because no INSHUR credentials exist yet, VIN-suffix-driven simulated ineligibility matrix documented in the settings UI

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (3): if_available is not actually safe: ineligible Connect accounts hard-fail the request, Deposit-hold card-feature downgrade ladder from richest to plainest variant, Idempotency keys suffixed by ladder index, so inserting a rung reshuffles replay meaning

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (3): The subscription hard block was enforced in the BROWSER only, so a grace-expired tenant could keep driving billable endpoints with a saved JWT, generate review summary gated, subscription gate partialcoverage

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): apps/portal automation-event-registry.ts — the client-side source this mirrors, Server-side mirror of the portal automation event registry (lead/rental/payment triggers)

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (2): Byte-for-byte-adjacent formatting helper duplicated in portal and booking, Tenant currency formatting for edge-function-generated documents

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (2): Stored Stripe customer ids are validated per account and mode before reuse, Kedic 2026-07 incident: a test-era customer id survived go-live and broke all payment collection

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (2): E.164 normalisation that refuses to assume a default country code, WhatsApp phone normalisation defaulting to +1 and stripping a UK leading zero

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (2): rental.created emitted explicitly via RPC because DB triggers watch leads, not rentals, notify_automation_event Postgres RPC (automation event bus)

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (2): accrue payg charges ledger rollback, A failed ledger insert deletes the claimed accrual row so the day index is not burned

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (2): The private bucket's storage PATH is stored, not a URL, and simulated cards carry the mode in both the path and the filename, ID-card extension and content type are derived from ABI's FILETYPE because the payload format is undocumented and may change

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (2): chat_channel_messages table, The matching voice chat message gets metadata.has_transcript so the chat UI can offer the transcript without re-querying call_logs

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): Two-tier extension guard: auto-extend rentals never get a hold from any caller; manually-extended rentals are blocked only for AUTOMATIC callers, and deliberate staff action passes manualOverride, rental_extensions table

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (2): When the record write fails AND the cancel fails, a live authorisation exists that no row points at — the ledger row is then its only trace and is written either way, The success write is a compare-and-set on 'processing' AND our own attempt_seq; zero rows updated means we no longer own the slot and our authorisation is the orphan

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (2): When the request exceeds what Stripe still allows, refund what Stripe allows and record the remainder as a manual (ledger-only) refund with an explicit reconciliation note, Stripe is the authority on how much is still refundable on a PaymentIntent — the local payments.refund_amount drifts when manual refunds, mixed payments or earlier failures leave it stale

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (2): knowledge_articles table, knowledge_articles are indexed with BOTH the tenant's own rows and the global rows (tenant_id IS NULL), unlike every other table which is strictly tenant-scoped

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (2): SAFETY INVARIANT 3 — no invented rows: a Stripe subscription that cannot be resolved to a tenant is reported as an orphan, never guessed at, Stripe subscriptions outlive tenants, so a metadata tenant_id is existence-checked before any write: an FK insert would simply error, and the row is reported as an orphan for a human to cancel in Stripe

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (2): A .lt() comparison against a NULL deposit_hold_expires_at yields NULL, not true, so rows with no known expiry were invisible to the old due filter, Ordered (oldest deadline first, unknown expiry ahead of everything) and limited with a wall-clock budget: the old serial unbounded loop was killed by the 400s ceiling, stranding rows in 'refreshing' that nothing reaps

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (2): Move gig-driver proofs from pending/ into the tenant/customer storage path, gig_driver_images table

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (2): compute-lead-score edge function, Lead score, band and reason resolved from compute-lead-score before insert

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (2): sms_message_log table (raw Twilio status-callback audit trail), The full Twilio form payload plus error code/message is archived in sms_message_log for deliverability forensics

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (2): resend service adminemailfallback, Recipient precedence: the submission's primary contact email, then the tenant admin email

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): A proven human identity always wins over a client-supplied actor when writing the deposit_hold_links ledger, so nobody can sign another person's name to a card authorisation

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): A numeric per-rental deposit override always wins, INCLUDING an explicit 0 meaning the operator opted out; only NULL falls back to the tenant default

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (1): deposit_source and the full estimate_inputs are recorded on the ledger row so 'why was THIS amount authorised?' is answerable months later

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): Card-feature downgrade ladder (extended authorization + multicapture down to nothing) because unapproved Connect accounts error instead of silently ignoring the request

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): deposit_hold_target_amount is deliberately left NULL: two amount columns with no defined precedence will drift on a money path, so it is wired up together with its reader or not at all

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (1): Card brand/last4/expiry/funding are captured off the PaymentMethod so a 90-day chain is auditable and debit stacking is detectable without a Stripe round-trip per rental

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (1): qr_session_token is nulled on completion so a finished mobile-handoff link cannot be replayed

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (1): Optional only_rental_id body scoping hard-restricts a manual dispatch to one rental's plans so it can never charge another tenant

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (1): The payments UPDATE error is now checked: it used to fail silently (missing paid_at column, chk_pnl_category_valid rejecting Extension* categories, FIFO ignoring target_categories) and the UI showed 'Payment Received' on a row still Pending

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (1): The unique index (rental_id, due_date, type, category, extension_id) makes two same-day refunds on one category collide, so the second MERGES into the existing Refund row instead of inserting

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): A PaymentIntent still at requires_capture cannot be refunded — the operator is told to capture first

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): The batch answers HTTP 200 with success:false on a fatal error, deliberately, so the supabase-js caller does not raise FunctionsHttpError

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (1): Conversion, embedding and upsert failures are counted per table and never abort the run — a partial index is better than none

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): Each sweep gets its own wall-clock reserve on top of the main deadline, because they used to share one and whichever ran second was starved on every busy run

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): A hold Stripe reports as requires_payment_method is handed back to the placement engine with a retry time but deliberately WITHOUT bumping deposit_hold_failure_count — a reconciler seeing the same failure four times a day would compound the backoff into silence

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (1): customers.email is unique PER TENANT, so the dedup match must be tenant-scoped, case-INSENSITIVE, and must escape LIKE metacharacters so john_doe@x.com is matched literally

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (1): Deliberately side-effect free: it creates data only and sends no email, SMS or webhook; phone is form-only so it is left NULL for the operator to complete

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (1): Rental lifecycle gating is a terminal-status DENY list rather than an ('Active','Pending') allow list, so a status nobody enumerated cannot silently end a chain

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (1): A Stripe charge_already_refunded error still counts toward totalRefunded — the money is back either way and the run must not report a false failure

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): Installments marked paid by hand carry no PaymentIntent, so there is nothing to refund at Stripe and only the ledger and plan state change

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): Fatal errors are returned as HTTP 200 with success:false, so the portal caller renders the partial result instead of a transport error

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): A payment with an amount but no Stripe PaymentIntent is flagged refund_status='pending_manual' for a human to settle, rather than silently marked refunded

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (1): A missing stripe_payment_intent_id is resolved from the checkout session and persisted back onto the payment row for future operations

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (1): Stripe TEST fixtures: customer, success/decline/SCA payment methods, seeded manual-capture hold

## Ambiguous Edges - Review These
- `index.ts` → `Inbound SMS/WhatsApp to lead-conversation ingestion`  [AMBIGUOUS]
  supabase/functions/lead-inbound-sms-webhook/index.ts · relation: conceptually_related_to
- `Shared CORS headers and jsonResponse/errorResponse/handleCors convention for every edge function` → `Caller authorisation boundary for the four deposit-hold money endpoints`  [AMBIGUOUS]
  supabase/functions/_shared/cors.ts · relation: conceptually_related_to
- `Convert Drive247 database records into searchable text documents for RAG indexing` → `hide_vehicle_registration enforced at variable-resolution time because tenants own editable template copies`  [AMBIGUOUS]
  supabase/functions/_shared/document-loaders.ts · relation: conceptually_related_to
- `Guard at composition, not rendering — the only point covering every downstream branch` → `Pay-As-You-Go charge accrual (rental + tax + service fee per window)`  [AMBIGUOUS]
  supabase/functions/_shared/vehicle-privacy.ts · relation: conceptually_related_to
- `Missing column (42703) is a schema gap, not a privacy request — staging lags production` → `only_rental_id sandbox scoping so a Time Machine dispatch can never touch other tenants`  [AMBIGUOUS]
  supabase/functions/_shared/vehicle-privacy.ts · relation: conceptually_related_to
- `Daily tenant-onboarding status digest` → `Header comment claims 8 onboarding checklist items but only 3 are evaluated`  [AMBIGUOUS]
  supabase/functions/onboarding-daily-digest/index.ts · relation: rationale_for
- `The function itself verifies no OTP — it trusts its caller with email plus new password` → `verification_otps table`  [AMBIGUOUS]
  supabase/functions/reset-password-with-otp/index.ts · relation: conceptually_related_to
- `Scanning the QR flips the verification row to pending/pending, which is how the desktop page learns the phone picked it up` → `Validation neither revokes nor rotates the QR token, so the same code stays usable until it expires`  [AMBIGUOUS]
  supabase/functions/validate-ai-session/index.ts · relation: conceptually_related_to
- `Deposit hold reconciliation against Stripe (read side)` → `AI insurance certificate legitimacy audit (gpt-4o vision, 0-100 score plus field extraction)`  [AMBIGUOUS]
  supabase/functions/verify-insurance-document/index.ts · relation: semantically_similar_to

## Knowledge Gaps
- **1007 isolated node(s):** `Why inject at render time instead of rewriting the operator's stored template row`, `Splice above the EARLIEST signature marker, not the first matching pattern`, `Byte-identical triplicate across portal, booking and the Deno edge function (three module resolvers)`, `Legacy {{vehicle_allowed_mileage}} check prevents stating the allowance twice in one contract`, `Unconfigured mileage renders 'Not specified', never 'Unlimited' — a missing field must not grant unlimited miles` (+1002 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 44`** (2 nodes): `apps/portal automation-event-registry.ts — the client-side source this mirrors`, `Server-side mirror of the portal automation event registry (lead/rental/payment triggers)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `Byte-for-byte-adjacent formatting helper duplicated in portal and booking`, `Tenant currency formatting for edge-function-generated documents`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `Stored Stripe customer ids are validated per account and mode before reuse`, `Kedic 2026-07 incident: a test-era customer id survived go-live and broke all payment collection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `E.164 normalisation that refuses to assume a default country code`, `WhatsApp phone normalisation defaulting to +1 and stripping a UK leading zero`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `rental.created emitted explicitly via RPC because DB triggers watch leads, not rentals`, `notify_automation_event Postgres RPC (automation event bus)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `accrue payg charges ledger rollback`, `A failed ledger insert deletes the claimed accrual row so the day index is not burned`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `The private bucket's storage PATH is stored, not a URL, and simulated cards carry the mode in both the path and the filename`, `ID-card extension and content type are derived from ABI's FILETYPE because the payload format is undocumented and may change`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `chat_channel_messages table`, `The matching voice chat message gets metadata.has_transcript so the chat UI can offer the transcript without re-querying call_logs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `Two-tier extension guard: auto-extend rentals never get a hold from any caller; manually-extended rentals are blocked only for AUTOMATIC callers, and deliberate staff action passes manualOverride`, `rental_extensions table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `When the record write fails AND the cancel fails, a live authorisation exists that no row points at — the ledger row is then its only trace and is written either way`, `The success write is a compare-and-set on 'processing' AND our own attempt_seq; zero rows updated means we no longer own the slot and our authorisation is the orphan`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `When the request exceeds what Stripe still allows, refund what Stripe allows and record the remainder as a manual (ledger-only) refund with an explicit reconciliation note`, `Stripe is the authority on how much is still refundable on a PaymentIntent — the local payments.refund_amount drifts when manual refunds, mixed payments or earlier failures leave it stale`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `knowledge_articles table`, `knowledge_articles are indexed with BOTH the tenant's own rows and the global rows (tenant_id IS NULL), unlike every other table which is strictly tenant-scoped`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `SAFETY INVARIANT 3 — no invented rows: a Stripe subscription that cannot be resolved to a tenant is reported as an orphan, never guessed at`, `Stripe subscriptions outlive tenants, so a metadata tenant_id is existence-checked before any write: an FK insert would simply error, and the row is reported as an orphan for a human to cancel in Stripe`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `A .lt() comparison against a NULL deposit_hold_expires_at yields NULL, not true, so rows with no known expiry were invisible to the old due filter`, `Ordered (oldest deadline first, unknown expiry ahead of everything) and limited with a wall-clock budget: the old serial unbounded loop was killed by the 400s ceiling, stranding rows in 'refreshing' that nothing reaps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `Move gig-driver proofs from pending/ into the tenant/customer storage path`, `gig_driver_images table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `compute-lead-score edge function`, `Lead score, band and reason resolved from compute-lead-score before insert`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `sms_message_log table (raw Twilio status-callback audit trail)`, `The full Twilio form payload plus error code/message is archived in sms_message_log for deliverability forensics`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `resend service adminemailfallback`, `Recipient precedence: the submission's primary contact email, then the tenant admin email`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `A proven human identity always wins over a client-supplied actor when writing the deposit_hold_links ledger, so nobody can sign another person's name to a card authorisation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `A numeric per-rental deposit override always wins, INCLUDING an explicit 0 meaning the operator opted out; only NULL falls back to the tenant default`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `deposit_source and the full estimate_inputs are recorded on the ledger row so 'why was THIS amount authorised?' is answerable months later`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `Card-feature downgrade ladder (extended authorization + multicapture down to nothing) because unapproved Connect accounts error instead of silently ignoring the request`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `deposit_hold_target_amount is deliberately left NULL: two amount columns with no defined precedence will drift on a money path, so it is wired up together with its reader or not at all`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `Card brand/last4/expiry/funding are captured off the PaymentMethod so a 90-day chain is auditable and debit stacking is detectable without a Stripe round-trip per rental`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `qr_session_token is nulled on completion so a finished mobile-handoff link cannot be replayed`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `Optional only_rental_id body scoping hard-restricts a manual dispatch to one rental's plans so it can never charge another tenant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `The payments UPDATE error is now checked: it used to fail silently (missing paid_at column, chk_pnl_category_valid rejecting Extension* categories, FIFO ignoring target_categories) and the UI showed 'Payment Received' on a row still Pending`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `The unique index (rental_id, due_date, type, category, extension_id) makes two same-day refunds on one category collide, so the second MERGES into the existing Refund row instead of inserting`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `A PaymentIntent still at requires_capture cannot be refunded — the operator is told to capture first`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `The batch answers HTTP 200 with success:false on a fatal error, deliberately, so the supabase-js caller does not raise FunctionsHttpError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `Conversion, embedding and upsert failures are counted per table and never abort the run — a partial index is better than none`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `Each sweep gets its own wall-clock reserve on top of the main deadline, because they used to share one and whichever ran second was starved on every busy run`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `A hold Stripe reports as requires_payment_method is handed back to the placement engine with a retry time but deliberately WITHOUT bumping deposit_hold_failure_count — a reconciler seeing the same failure four times a day would compound the backoff into silence`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `customers.email is unique PER TENANT, so the dedup match must be tenant-scoped, case-INSENSITIVE, and must escape LIKE metacharacters so john_doe@x.com is matched literally`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `Deliberately side-effect free: it creates data only and sends no email, SMS or webhook; phone is form-only so it is left NULL for the operator to complete`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `Rental lifecycle gating is a terminal-status DENY list rather than an ('Active','Pending') allow list, so a status nobody enumerated cannot silently end a chain`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `A Stripe charge_already_refunded error still counts toward totalRefunded — the money is back either way and the run must not report a false failure`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `Installments marked paid by hand carry no PaymentIntent, so there is nothing to refund at Stripe and only the ledger and plan state change`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `Fatal errors are returned as HTTP 200 with success:false, so the portal caller renders the partial result instead of a transport error`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `A payment with an amount but no Stripe PaymentIntent is flagged refund_status='pending_manual' for a human to settle, rather than silently marked refunded`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `A missing stripe_payment_intent_id is resolved from the checkout session and persisted back onto the payment row for future operations`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `Stripe TEST fixtures: customer, success/decline/SCA payment methods, seeded manual-capture hold`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `index.ts` and `Inbound SMS/WhatsApp to lead-conversation ingestion`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Shared CORS headers and jsonResponse/errorResponse/handleCors convention for every edge function` and `Caller authorisation boundary for the four deposit-hold money endpoints`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Convert Drive247 database records into searchable text documents for RAG indexing` and `hide_vehicle_registration enforced at variable-resolution time because tenants own editable template copies`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Guard at composition, not rendering — the only point covering every downstream branch` and `Pay-As-You-Go charge accrual (rental + tax + service fee per window)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Missing column (42703) is a schema gap, not a privacy request — staging lags production` and `only_rental_id sandbox scoping so a Time Machine dispatch can never touch other tenants`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Daily tenant-onboarding status digest` and `Header comment claims 8 onboarding checklist items but only 3 are evaluated`?**
  _Edge tagged AMBIGUOUS (relation: rationale_for) - confidence is low._
- **What is the exact relationship between `The function itself verifies no OTP — it trusts its caller with email plus new password` and `verification_otps table`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._