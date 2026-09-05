# Graph Report - booking  (2026-09-04)

## Corpus Check
- 295 files · ~289,456 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2176 nodes · 4199 edges · 54 communities detected
- Extraction: 86% EXTRACTED · 13% INFERRED · 1% AMBIGUOUS · INFERRED: 546 edges (avg confidence: 0.79)
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
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
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
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]

## God Nodes (most connected - your core abstractions)
1. `useTenant()` - 44 edges
2. `rentals table` - 43 edges
3. `tenants table` - 26 edges
4. `Customer rental detail: one screen joining rental, vehicle, agreements, insurance, ledger, payments and installments` - 21 edges
5. `GET()` - 20 edges
6. `POST()` - 20 edges
7. `Number()` - 18 edges
8. `Checkout booking creation: customer, rental, invoice, payment routing` - 18 edges
9. `customers table` - 18 edges
10. `proceedWithPayment()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Client-only enforcement of operator 'extra required' fields layered on top of the optional-by-default Zod schema` --shares_data_with--> `Application submission → lead ingestion (leads, lead_documents, conversations, lead_activity)`  [AMBIGUOUS]
  apps/booking/src/components/apply/apply-form.tsx → supabase/functions/submit-application/index.ts
- `Client-side pickup/return date bounds — no past dates, 2-year cap, return ≥ pickup` --semantically_similar_to--> `Server-side application date validation (licence expiry, pickup, return, needed-by cannot be in the past)`  [INFERRED] [semantically similar]
  apps/booking/src/components/apply/step-3-intent.tsx → supabase/functions/submit-application/index.ts
- `Rationale: local Safari-safe YYYY-MM-DD parser because Safari rejects new Date('YYYY-MM-DD')` --semantically_similar_to--> `calculateRentalPriceBreakdown()`  [INFERRED] [semantically similar]
  apps/booking/src/components/MultiStepBookingWidget.tsx → apps/booking/src/lib/calculate-rental-price.ts
- `Customer-facing AI insurance-document scan progress UI` --shares_data_with--> `AI insurance document scan/verification pipeline (writes scan status, extracted data, scores)`  [INFERRED]
  apps/booking/src/components/ai-scan-progress.tsx → supabase/functions/scan-insurance-document/index.ts
- `Hidden honeypot field (hpField) as bot/spam guard on the application form` --shares_data_with--> `Application submission → lead ingestion (leads, lead_documents, conversations, lead_activity)`  [INFERRED]
  apps/booking/src/components/apply/apply-form.tsx → supabase/functions/submit-application/index.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (50): AnnouncementModalGate(), handleUpload(), resetForm(), canvas-confetti, class-variance-authority, clsx, cmdk, date-fns (+42 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (244): QR image rendered by external quickchart.io API rather than locally, QR handoff of identity verification to the customer's phone, Realtime per-step verification progress (initial fetch + postgres_changes channel), RETRY means manual review, customer is still allowed to proceed, GREEN/RED/RETRY verification outcome gating, apply-payment edge function, backfill_rental_charges_first_month_only SQL function, Blocked-customer dialog routing to tenant support email/phone (+236 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (43): isoMaxDateOfBirth(), isoMinDateOfBirth(), isoToday(), handleSubmit(), validate(), today(), twoYearsOut(), date-fns-tz (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (165): Rationale: splice at block boundaries — mid-paragraph insertion makes the PDF block parser emit literal BLOCK_18 markers, Rationale: injection is conditional on the operator's own configured data, so no clause is forced on anyone, Rationale: splice above the EARLIEST signature marker in the document, not the first matching pattern, Rationale: also detect the legacy {{vehicle_allowed_mileage}} placeholder so mileage is not stated twice in two formats, Render-time injection of mileage, T&C and Bonzah clauses into stored agreement templates, Rationale: inject at render time rather than rewriting the operator-owned stored template row, Coupling: agreement-injection is byte-identical in portal, booking and the Deno edge function and must be changed in all three, Rationale: the excess rate is a money term in a signed contract, so currency code and distance unit come from tenant settings (+157 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (156): admin_settings table, getBonzahSellability - authoritative server-side Bonzah sell gate, usePageContent + mergeWithDefaults CMS fallback pattern, CMS-driven 'why choose us' service highlights section, CMS icon-name to lucide component allow-list (16 icons, ThumbsUp fallback), 5-second auto-rotating 3-per-page testimonial pagination, Paged testimonial grid — second implementation of the same tenant-testimonial read, Tenant-scoped public testimonial carousel (+148 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (108): accrue-payg-charges cron job, blocked_dates table, bonzah-calculate-premium edge function, bonzah-check-vehicle-eligibility edge function, bonzah_insurance_policies table, supabaseUntyped used where generated types lag the PAYG schema, Convention: every query key is prefixed with tenant id for cache isolation, check_rental_overlap Postgres trigger (+100 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (89): Statement is explicitly NOT a tax invoice — itemised tax lives on rental invoices, Per-rental grouping with category rollup and fines highlighted, Hidden inline-styled print copy so print fidelity isn't tied to Tailwind, Deterministic statement number STMT-yyyyMMdd-{customer token}, Customer statement of account (charged / paid / outstanding), Base period is part of the original booking, so it is rendered as already covered, First outstanding auto-extension pay-link is promoted to a prominent CTA, Per-period rate is shown tax-inclusive (monthly_amount grossed up by tenant tax %) (+81 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (52): buildRentalTimeFacts(), buildTimeVariables(), formatDateOnly(), formatScheduledDateTime(), formatTimeOfDay(), formatZonedDate(), formatZonedDateTime(), isValidTimeZone() (+44 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (46): fmt(), round2(), bonzahCanInsureThrough(), clampToBonzahStart(), getPacificToday(), getPacificTomorrow(), buildRentalBreakdown(), calculateDeliveryFees() (+38 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (63): CustomerAuthProvider(), CustomerRealtimeChatProvider(), getEffectiveDeliveryRadius(), getMaxDistanceKm(), getTierFeeRange(), hasActiveTiers(), normalizeTiers(), resolveDeliveryFee() (+55 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (39): Vestigial pages-router _app.tsx — a bare pass-through; the real provider chain lives in the App Router layout, DayWithTooltip(), @supabase/supabase-js, handleSubmit(), getTenantThemeMode(), RootLayout(), ensureSmsDisclosure(), ensureTermsSmsCompliance() (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (61): accept-offer edge function, redirectToInstallmentCheckout(), Attach a booking reference to an outgoing chat message, formatRentalNumber(), handleSelect(), A searchable hidden plate is not hidden — reg excluded from the search index when redacted, Plate resolved at attach time so it never enters the persisted chat message, Booking reference card rendered inside a chat bubble (+53 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (42): Pages Router HTML shell coexisting with the App Router, Pages Router fallback error / 404 page, Hardcoded gold #C6A256 and dark chrome bypass per-tenant branding on the error page, Portal auth store: setTimeout(0) Supabase deadlock workaround, Blocked-customer detection diverts signup/login to BlockedAccountDialog, Post-booking guest to customer-account conversion prompt, Six-digit OTP email verification for new customer signups, OTP-based customer password reset (send, verify, set new) (+34 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (44): calculateRentalPriceBreakdown(), findMatchingHoliday(), formatDate(), getDayRate(), parseDateString(), calculateTotalMileageAllowance(), getMileageTier(), getTierMileage() (+36 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (42): Announcement rich text rendered through a DOMPurify allowlist, Blocking 'new feature' modal for major announcements, Gate that surfaces the next unseen major announcement once per customer, Seen and dismissed are separate writes: seen on first render, dismissed on close, Opening the drawer deliberately does not clear unread state, What's-new drawer with unread badge and per-item expand, Paginated, category-filtered blog listing, Blog feature flag gate: redirect home when tenant.blog_enabled is false (+34 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (45): Customer signup password policy, create-ai-verification-session edge function, create-ai-verification-session edge function, customer-documents storage bucket, gig-driver-images storage bucket, Root error boundary fallback screen, identity_verifications table, Synchronous ref guard against double-submitting an upload (+37 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (32): Booking store — sessionStorage-persisted booking form/step state, Checkout & payment step (review, promo, installments), invoices table, gtag funnel analytics across steps, fleet interactions and verification outcomes, Per-vehicle Bonzah eligibility check gates the 'get insurance' option, Rationale: in Bonzah test mode the policy is sandbox-only and not real cover, so the purchase option is hidden while the own-insurance path stays open, Booking state survives refresh: Zustand store in sessionStorage plus booking_* localStorage keys, Five-step customer booking wizard (+24 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (34): bonzah_insurance_policies table, payg_accruals table, Rolling cumulative invoice supersedes earlier unpaid days, PAYG charge category triple: Rental, Tax, Service Fee, Pay-As-You-Go daily invoice ledger dialog, Only the latest open cumulative invoice is payable, payg_reminder_log table, Inline PAYG card on the customer rental page (+26 more)

### Community 18 - "Community 18"
Cohesion: 0.1
Nodes (25): Apply schema date helpers (isoToday, isoMinDateOfBirth, isoMaxDateOfBirth, computeAge, MIN_APPLICANT_AGE), Client-only enforcement of operator 'extra required' fields layered on top of the optional-by-default Zod schema, apply_form_config table (hidden_steps, required_overrides, welcome_message), Rationale: FunctionsHttpError wraps the Response — without cloning/parsing it the user only sees 'Edge Function returned a non-2xx status code', Hidden honeypot field (hpField) as bot/spam guard on the application form, Rationale: on submit-time validation failure jump back to the step owning the bad field, else Submit appears to do nothing, Seven-step rental application wizard (Apply flow), Operator Apply-form settings surface referenced as portal /settings/apply-form (+17 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (21): create-checkout-session edge function, Cumulative overdue settlement stamped on the latest installment id, Customer-facing installment plan view (calendar + schedule + progress), Day-zero upfront display override (deposit + fees folded into slot 1), Direct Stripe Checkout redirect for an installment (no magic-link middleware), Rationale: paying the overdue total under the latest installment id lets the webhook supersede earlier slots, Rationale: scheduled_installments rows carry only the rental portion, so day zero would understate what is owed, Rationale: same flow as PAYG customer Pay and operator Charge via Stripe; webhook settles via installment_id metadata (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (16): blog_categories table, blog_posts table, TenantContext as the tenant scope for every booking hook, lead-document-presign edge function, lead-documents storage bucket, Blog URLs included only when the tenant blog is enabled, Apply wizard step 6 document capture (Spec 6.2), Client-side upload gate: 10MB max, JPG/PNG/PDF only (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (8): dotenv, lovable-tagger, path, @testing-library/jest-dom, vite, @vitejs/plugin-react, @vitejs/plugin-react-swc, vitest

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (15): chat_channel_messages table, chat_channels table, Auto get-or-create of one chat channel per (tenant, customer), Customer-side channel naming convention chat:{customerId}:{topic}, Customer presence tracking and tenant online/offline signalling, Socket.io-compatible chat API implemented over Supabase Realtime, Typing indicator over a Realtime broadcast channel, Unread operator-message badge on the floating chat launcher (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (8): handleBack(), handleCapture(), handleFileUpload(), handleNext(), handleSkipBack(), processVerification(), stopCamera(), uploadImage()

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (4): detectPlatform(), getPushCapability(), isStandalone(), ServiceWorkerRegistrar()

### Community 25 - "Community 25"
Cohesion: 0.2
Nodes (12): Customer-facing AI insurance-document scan progress UI, Backwards-compat fallback from effectiveDate/expirationDate to legacy startDate/endDate in extracted data, Design choice: 1.5s polling of customer_documents instead of a Supabase realtime subscription, Portal staff copy of the same AI insurance scan progress UI, AI verification decision surface — auto_approved / pending_review / auto_rejected, validation & confidence scores, fraud-risk flag, boldsign-webhook edge function, customer_documents table (ai_scan_status, ai_extracted_data, ai_validation_score, ai_confidence_score), rental_agreements table (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (12): Multi-step booking flow context (dates, location, driver, extras, insurance), Legacy delivery/collection fields retained for backward compatibility alongside deliveryOption, Legacy sessionStorage/localStorage booking key cleanup on clearBooking, Rationale: the store IS the form state (no useState copy) so it survives refresh and tab close/reopen, Only widget fields are persisted; the booking context is deliberately in-memory, Pending pre-account uploads (insurance proof, gig-driver proof) held until a customer/booking exists, SSR-safe no-op storage fallback when window is undefined, Step gating via highestStepReached (only steps reached through Next are re-enterable) (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (5): useActiveInstallmentPlans(), useCustomerInstallmentPlans(), useInstallmentStats(), useNextInstallmentPayment(), useRentalInstallmentPlan()

### Community 28 - "Community 28"
Cohesion: 0.24
Nodes (10): Applicant age bounds and their justification, Rationale: schema duplicated as a Deno copy for the submit-application edge function, Honeypot spam field on the application form, Lead application multi-step form schema, Per-step wizard validation schemas, Years-driving cannot exceed age minus 16, Enquiry-based booking request schema, Honeypot spam field on the enquiry form (+2 more)

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (9): Rationale: helper never throws so it can be awaited inline in the esign route without risking the agreement flow, Reuses the same reminders / reminder_config infrastructure as the Bonzah low-balance monitor, Depleted credits park rental agreements as document_status='credit_failed' and the customer never gets the contract, Low e-sign credit alerting for tenants, Reminder dedupe + warning→critical escalation only (no re-alert per deduction), Test mode never spends live credits, so alerting is skipped entirely, credit_costs table, reminder_config table (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.32
Nodes (5): CustomerExtensionCalendar(), optimizedImageUrl(), cn(), fullUrl(), thumbUrl()

### Community 35 - "Community 35"
Cohesion: 0.5
Nodes (5): Chat hook returns inert no-op defaults when the provider is not mounted, Rationale: client Navigation/Footer SSR fallback showed platform default branding and failed A2P 10DLC vetting (30908/30882), Server-rendered tenant-branded chrome for /privacy, /terms and /sms-opt-in, Per-tenant legal-entity line linking public brand to the registered messaging Brand, useTenant returns safe defaults during SSR / when provider is unmounted

### Community 36 - "Community 36"
Cohesion: 0.4
Nodes (5): Portal copy of COVERAGE_INFO disclosure copy, COMPLIANCE DATA — DO NOT REWORD: transcribed from Bonzah's disclosure document, COVERAGE_INFO insurer disclosure copy (CDW/RCLI/SLI/PAI), PAI deductible corrected from None to $25 — the badge understated it to renters, SLI is not standalone — it must be bought with RCLI

### Community 37 - "Community 37"
Cohesion: 0.5
Nodes (3): tailwindcss, tailwindcss-animate, @tailwindcss/typography

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): Booking loads env from the monorepo root .env at config time, Standalone output with monorepo-root file tracing for Vercel deployment, Tailwind config resolved by absolute path so PostCSS finds it from the monorepo root

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): TypeScript and ESLint errors ignored during booking production builds, Booking Vitest bootstrap (jest-dom + matchMedia/ResizeObserver/IntersectionObserver mocks), mirroring apps/portal, Rationale: vitest.config.ts referenced this setup file since it was written but the file never existed, so any booking test failed on a missing module before a single assertion ran

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (3): send-signing-email edge function, BoldSign emails disabled; platform sends its own signing email, Signing-link retry loop (6 attempts, ~15s) before emailing customer

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (3): Application-submitted outcome messaging by status, Rental application entry page, Rationale (spec 6.7): never disclose blacklisting to the applicant

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (3): Hard-coded single-brand marketing copy ('Supreme Drive', close protection) in a multi-tenant app, Dead trust-badge section: trustPoints data defined but the section renders empty, Reusable marketing hero primitive (overlay strengths, dual CTA, trust line)

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (3): Booking widget listener for the VERIFF_COMPLETE postMessage contract, Rationale: iOS Safari cannot reliably close/return from the Veriff popup, so the parent window is notified explicitly, Veriff popup completion bridge — postMessage VERIFF_COMPLETE to opener then self-close

### Community 44 - "Community 44"
Cohesion: 0.67
Nodes (3): Deprecated portfolio showcase - backing table removed, renders nothing, Client-side portfolio facet filters (service type, vehicle, location, year, search), Portfolio image lightbox with keyboard navigation

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (3): Cross-tenant signup for an email already registered on another tenant, Rationale: orphan auth users (no customer row for this tenant) trapped users in a signup/login loop; route through customer-signup to self-heal, customer-signup edge function

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (2): Rationale: home-page widget is the only booking path, so stray links must never strand a customer in the dead flow (/booking-enquiry-submitted deliberately unmatched), Deprecated multi-page /booking flow redirected to home

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (2): Supabase auth callback handling (email confirm, magic link, OAuth), Rationale: retry getSession after 1s because hash tokens may still be processing

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (2): iOS/Android/desktop manual install instructions for browsers without the install prompt, PWA install capability using the deferred beforeinstallprompt event

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (2): Floating scroll-to-top button (appears past 300px), App Router pathname-change scroll reset

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (2): Tesla supercharger charge rollup surfaced to the renter, tesla_supercharger_charges table

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (2): 'Shared a booking' sentinel body used when only a booking is attached, Sentinel body suppressed on render by exact string comparison

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): Transcript grouped into date buckets, Second copy of the date-grouping helper

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (2): PAYG invoice status pill (paid / superseded / not paid), Second copy of the PAYG invoice status pill

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (2): /api/esign/sign route — mints an embedded signing URL or falls back to emailing the link, Customer-initiated signing-link request with email fallback

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (2): Pickup→dropoff distance via OSRM driving route with Haversine straight-line fallback, OSRM public routing API (external)

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): Webpack extensionAlias + node-module fallbacks working around @supabase/supabase-js ESM resolution in Next 15

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (1): Today/Yesterday date separator for chat transcripts

## Ambiguous Edges - Review These
- `Customer identity verification hub: status, document images, history and re-verification` → `Server-side Veriff status check: HMAC-signed request, attempts-then-decision endpoint fallback, code to GREEN/RED/RETRY mapping`  [AMBIGUOUS]
  apps/booking/src/app/api/check-veriff-status/route.ts · relation: conceptually_related_to
- `Public fleet catalogue and pricing page` → `Promotions vehicle lookup selects columns the fleet page does not use`  [AMBIGUOUS]
  apps/booking/src/app/promotions/page.tsx · relation: conceptually_related_to
- `Rationale: skip the tenant-null first pass so hidden plates never flash` → `Conditional tenant filter pattern on public catalogue queries`  [AMBIGUOUS]
  apps/booking/src/app/fleet/page.tsx · relation: conceptually_related_to
- `Offer accepted confirmation screen` → `Installment magic-link payment redirect`  [AMBIGUOUS]
  apps/booking/src/app/offer/[code]/accepted/page.tsx · relation: conceptually_related_to
- `Invite-token customer self-registration` → `Customer signup password policy`  [AMBIGUOUS]
  apps/booking/src/client-schemas/auth.ts · relation: conceptually_related_to
- `Legal and SMS-consent pages are absent from the sitemap` → `Public SMS consent record for A2P 10DLC vetting`  [AMBIGUOUS]
  apps/booking/src/app/sitemap.ts · relation: conceptually_related_to
- `tenants table` → `Stacked platform-global and per-tenant maintenance notice strips`  [AMBIGUOUS]
  apps/booking/src/components/MaintenanceBanner.tsx · relation: reads_table
- `Blocked-customer dialog routing to tenant support email/phone` → `CMS-driven contact block with hardcoded fallbacks for phone and email`  [AMBIGUOUS]
  apps/booking/src/components/ContactCard.tsx · relation: conceptually_related_to
- `window.gtag global defined here is the contract the booking flow's checkout_submitted events depend on` → `Invoice CTA hands off to e-signature, or to payment / enquiry submission for enquiry tenants`  [AMBIGUOUS]
  apps/booking/src/components/GoogleAnalytics.tsx · relation: conceptually_related_to
- `Public booking-site top navigation bar` → `404 fallback page logging the missing route to the console`  [AMBIGUOUS]
  apps/booking/src/components/NotFound.tsx · relation: conceptually_related_to
- `Client-only enforcement of operator 'extra required' fields layered on top of the optional-by-default Zod schema` → `Application submission → lead ingestion (leads, lead_documents, conversations, lead_activity)`  [AMBIGUOUS]
  apps/booking/src/components/apply/apply-form.tsx · relation: shares_data_with
- `Full-screen vehicle photo gallery with thumbnail strip` → `Optional rental extras selection (toggle or quantity stepper)`  [AMBIGUOUS]
  apps/booking/src/components/booking/VehicleImageLightbox.tsx · relation: conceptually_related_to
- `Per-rental insurance policy summary with CDW/RCLI/SLI/PAI coverage badges` → `Customer rental summary card and self-service action hub`  [AMBIGUOUS]
  apps/booking/src/components/customer-portal/RentalCard.tsx · relation: conceptually_related_to
- `Popup-sized copy of the customer chat window without outer chrome` → `Chat barrel exports only the full window — compact variant and picker are unlisted`  [AMBIGUOUS]
  apps/booking/src/components/customer-portal/chat/index.ts · relation: references
- `Enquiry (lead) capture for dates or cars not bookable online` → `Enquiry-based booking mode (deposit only, or no upfront charge at all)`  [AMBIGUOUS]
  apps/booking/src/config/tenant-config.ts · relation: conceptually_related_to
- `Customer-facing installment plan view (calendar + schedule + progress)` → `Tenant resolution chain: subdomain then custom domain then dev default slug`  [AMBIGUOUS]
  apps/booking/src/components/installments/CustomerInstallmentsView.tsx · relation: conceptually_related_to
- `Direct Stripe Checkout redirect for an installment (no magic-link middleware)` → `Stripe.js publishable key with a hardcoded test-key fallback`  [AMBIGUOUS]
  apps/booking/src/config/stripe.ts · relation: conceptually_related_to
- `Deprecated portfolio showcase - backing table removed, renders nothing` → `Portfolio image lightbox with keyboard navigation`  [AMBIGUOUS]
  apps/booking/src/components/portfolio/PortfolioGallery.tsx · relation: semantically_similar_to
- `Live sync of an installment plan, its installments and its notification timeline` → `Realtime invalidation targets installment-plan / installment-plan-full keys, not the customer portal's customer-installment-plans key`  [AMBIGUOUS]
  apps/booking/src/hooks/use-installment-plan-realtime.ts · relation: rationale_for
- `768px mobile breakpoint detection` → `Tenant branding resolution for the booking site`  [AMBIGUOUS]
  apps/booking/src/hooks/use-mobile.tsx · relation: conceptually_related_to
- `Authoritative per-extension totals from the rental_extension_totals view` → `Convention: every query key is prefixed with tenant id for cache isolation`  [AMBIGUOUS]
  apps/booking/src/hooks/use-rental-extension-totals.ts · relation: conceptually_related_to
- `Remaining stock computed by summing every selection ever made for the extra` → `rental_extras_selections table`  [AMBIGUOUS]
  apps/booking/src/hooks/use-rental-extras.ts · relation: conceptually_related_to
- `Bonzah vehicle eligibility check before offering insurance` → `Convention: every query key is prefixed with tenant id for cache isolation`  [AMBIGUOUS]
  apps/booking/src/hooks/useBonzahVehicleEligibility.ts · relation: conceptually_related_to
- `Booking-site tenant resolution: subdomain fast path, then custom_booking_domain lookup, injected as x-tenant-slug` → `Vestigial pages-router _app.tsx — a bare pass-through; the real provider chain lives in the App Router layout`  [AMBIGUOUS]
  apps/booking/src/pages/_app.tsx · relation: conceptually_related_to
- `Customer authentication store (auth.users -> customer_users -> customers)` → `Vitest + jsdom test harness (configured, booking has no test files yet)`  [AMBIGUOUS]
  apps/booking/vitest.config.ts · relation: governs

## Knowledge Gaps
- **480 isolated node(s):** `Deprecated multi-page /booking flow redirected to home`, `Rationale: home-page widget is the only booking path, so stray links must never strand a customer in the dead flow (/booking-enquiry-submitted deliberately unmatched)`, `Webpack extensionAlias + node-module fallbacks working around @supabase/supabase-js ESM resolution in Next 15`, `Standalone output with monorepo-root file tracing for Vercel deployment`, `TypeScript and ESLint errors ignored during booking production builds` (+475 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 46`** (2 nodes): `Rationale: home-page widget is the only booking path, so stray links must never strand a customer in the dead flow (/booking-enquiry-submitted deliberately unmatched)`, `Deprecated multi-page /booking flow redirected to home`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `Supabase auth callback handling (email confirm, magic link, OAuth)`, `Rationale: retry getSession after 1s because hash tokens may still be processing`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `iOS/Android/desktop manual install instructions for browsers without the install prompt`, `PWA install capability using the deferred beforeinstallprompt event`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `Floating scroll-to-top button (appears past 300px)`, `App Router pathname-change scroll reset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `Tesla supercharger charge rollup surfaced to the renter`, `tesla_supercharger_charges table`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `'Shared a booking' sentinel body used when only a booking is attached`, `Sentinel body suppressed on render by exact string comparison`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `Transcript grouped into date buckets`, `Second copy of the date-grouping helper`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `PAYG invoice status pill (paid / superseded / not paid)`, `Second copy of the PAYG invoice status pill`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `/api/esign/sign route — mints an embedded signing URL or falls back to emailing the link`, `Customer-initiated signing-link request with email fallback`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `Pickup→dropoff distance via OSRM driving route with Haversine straight-line fallback`, `OSRM public routing API (external)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `Webpack extensionAlias + node-module fallbacks working around @supabase/supabase-js ESM resolution in Next 15`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `Today/Yesterday date separator for chat transcripts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Customer identity verification hub: status, document images, history and re-verification` and `Server-side Veriff status check: HMAC-signed request, attempts-then-decision endpoint fallback, code to GREEN/RED/RETRY mapping`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Public fleet catalogue and pricing page` and `Promotions vehicle lookup selects columns the fleet page does not use`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Rationale: skip the tenant-null first pass so hidden plates never flash` and `Conditional tenant filter pattern on public catalogue queries`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Offer accepted confirmation screen` and `Installment magic-link payment redirect`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Invite-token customer self-registration` and `Customer signup password policy`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Legal and SMS-consent pages are absent from the sitemap` and `Public SMS consent record for A2P 10DLC vetting`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `tenants table` and `Stacked platform-global and per-tenant maintenance notice strips`?**
  _Edge tagged AMBIGUOUS (relation: reads_table) - confidence is low._