# Graph Report - portal  (2026-09-04)

## Corpus Check
- 1087 files · ~1,070,975 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 7251 nodes · 17503 edges · 99 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 2760 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
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
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]

## God Nodes (most connected - your core abstractions)
1. `useTenant()` - 297 edges
2. `toast()` - 173 edges
3. `format()` - 83 edges
4. `Select()` - 83 edges
5. `rentals table` - 83 edges
6. `update()` - 78 edges
7. `String()` - 76 edges
8. `ledger_entries table` - 57 edges
9. `tenants table (branding and operational settings)` - 52 edges
10. `useToast()` - 50 edges

## Surprising Connections (you probably didn't know these)
- `Automation trigger event registry (Spec 7.1)` --semantically_similar_to--> `Shared edge-function automation event registry`  [INFERRED] [semantically similar]
  apps/portal/src/lib/automation-event-registry.ts → supabase/functions/_shared/automation-events.ts
- `Client-side dark-mode brand colour derivation for the portal Branding settings UI` --semantically_similar_to--> `buildTenantPalette: edge-function dark palette derivation used at tenant provisioning`  [INFERRED] [semantically similar]
  apps/portal/src/lib/brand-palette.ts → supabase/functions/_shared/brand-colors.ts
- `_shared/deposit-hold-auth - shared deposit-hold authorisation gate being extracted` --semantically_similar_to--> `canEdit - per-tab manager editor gate`  [INFERRED] [semantically similar]
  supabase/functions/_shared/deposit-hold-auth.ts → apps/portal/src/hooks/use-manager-permissions.ts
- `Every tenant shares Drive247's single Bonzah test account; live mode requires the tenant's own credentials` --semantically_similar_to--> `Stripe test mode shares one platform Connect account across all tenants`  [INFERRED] [semantically similar]
  apps/portal/src/components/settings/bonzah-settings.tsx → supabase/functions/_shared/stripe-client.ts
- `Verification magic link delivered over email / SMS / WhatsApp with a resend path` --semantically_similar_to--> `Submit fires AI verdict and partner email best-effort so neither can block the application`  [AMBIGUOUS] [semantically similar]
  apps/portal/src/hooks/use-cmd-verification.ts → apps/portal/src/hooks/use-bonzah-onboarding.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (116): signingBadge(), verificationBadge(), getGroupStatusBadge(), getStatusInfo(), formatRentalNumber(), handleSelect(), handleSave(), getColumns() (+108 more)

### Community 1 - "Community 1"
Cohesion: 0.0
Nodes (791): Fleet utilisation donut reusing the shared dashboard KPI hook rather than its own query, Customer document upload with type, expiry and vehicle association, Document Active/Expired status derived from end_date at write time, Insurance-certificate-only fields (provider, policy number, policy dates), Replace-on-upload deletes the previous storage object before writing the new one, Tenant-scoped customer -> rental -> vehicle/reg cascade for fine attribution, Creating a fine never charges the customer - charging is an explicit second action, Customer and vehicle auto-link each other through the active-rentals map (+783 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (484): fmtMoney(), String(), fmtMoney(), chargeRequestIdFor(), extractFunctionErrorDetail(), fnv1aHex(), handleChargeSavedCard(), invalidateAllPaymentQueries() (+476 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (119): applyCustomColor(), applyPalette(), formFromBranding(), handleSave(), paletteFromBrandColor(), resetToDefault(), fetchAppUserResult(), sleep() (+111 more)

### Community 4 - "Community 4"
Cohesion: 0.01
Nodes (412): AccountingSyncLog(), handleSendInvoiceEmail(), handleStripePayment(), AppSidebar(), Sidebar billing status chip (Live / Setup Mode / payment due), Manager per-tab filtering of sidebar nav and settings tabs, Pending Bookings nav item only exists when the tenant runs manual payment mode, Rationale: close the mobile sheet on nav tap for instant perceived feedback (+404 more)

### Community 5 - "Community 5"
Cohesion: 0.01
Nodes (359): accrue-payg-charges cron edge function, add_credits SQL function, Fine liability split: Customer (recharged) vs Business (absorbed), defaulting to Customer, Manual/offline payment recording against a customer, outside the Stripe flow, Manual operator reminder creation, 12-hour local picker converted to a UTC ISO instant for due_on and remind_on, Reminder severity (critical/warning/info) and object-type taxonomy, Additional driver verification and signing status with invite resend (+351 more)

### Community 6 - "Community 6"
Cohesion: 0.01
Nodes (361): Purchase vs Finance acquisition badge with P&L tooltip, Customer document intake with a fixed document-type taxonomy, Insurance-certificate sub-form (provider, policy number, cover window) grafted onto a generic document, Basic license-plate registration form, Dialog-shown audit logging convention (useAuditLogOnOpen + logAction on mutate), Private-plate procurement and fitting lifecycle, DVLA retention-document reference held against the plate, Vehicle service-record logging with a fixed service-type vocabulary (+353 more)

### Community 7 - "Community 7"
Cohesion: 0.01
Nodes (276): classifyVerify(), describeHoldSkip(), describeInProgress(), A missing or renamed liveHold field reads as live, never as dead, getBookingOrigin(), GMT incident: a green Held badge over a dead authorisation with no next action, handlePlaceViaStripe(), handleSendEmail() (+268 more)

### Community 8 - "Community 8"
Cohesion: 0.01
Nodes (130): useAccountingBanners(), AccountingConnectionExpiredBanner(), handleSubmit(), handleSubmit(), AppBannerStack(), banner(), dismissible(), extraLineTotal() (+122 more)

### Community 9 - "Community 9"
Cohesion: 0.01
Nodes (229): Pricing engine dailyPrices input - manual per-day prices short-circuit tier and surcharge maths, Shared rental price calculation (duplicated byte-for-byte in portal and booking), Turo-style per-day pricing grid mode toggled against the bookings timeline, Weekend/holiday surcharge markers on the calendar date header, Customer-side distance-tier delivery fee resolution, admin-toggle-lead-management edge function, bonzah-grade-quiz edge function, create-credit-checkout edge function (+221 more)

### Community 10 - "Community 10"
Cohesion: 0.01
Nodes (175): Rationale: splice at the enclosing block start or the PDF block parser emits literal BLOCK_18 markers, Rationale: injection is conditional on the tenant's own configuration, so no clause is forced on anyone, Rationale: splice above the EARLIEST signature marker in the document, not the first pattern that matches, Rationale: legacy vehicle_allowed_mileage placeholder check stops the allowance being stated twice, Rationale: inject at render time instead of rewriting the operator's stored template row, Render-time injection of mileage, terms and Bonzah clauses into stored agreement templates, Three byte-identical copies of the injector: portal, booking, Deno edge function, Rationale: preview mirrors the full-page editor by injecting the render-time Bonzah addendum, so operators see what is actually sent (+167 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (112): buildTimeVariables(), formatZonedDate(), blockStartBefore(), hasPlaceholder(), Regenerating an agreement must not duplicate the clause, injectAgreementClauses(), injectBonzahAddendum(), injectDepositClause() (+104 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (158): Monthly revenue / expense / net-profit performance overview, Expense categorisation prefers pnl_entries, falling back to vehicle_expenses + service_records when no P&L rows exist, Rationale: verification_status is not a settlement signal (defaults to auto_approved, reverse-payment never clears it) so revenue is gated on payment status, Rationale: sumReceived also drops uncaptured pre-auth holds, which can carry status Applied with capture_status requires_capture, Accounts-receivable ageing by customer (0-30/31-60/61-90/90+ buckets), Worst-bucket severity icon derived client-side from the highest non-zero bucket, Revenue on this chart is booked rentals.monthly_amount, not money actually received, Business activity trend chart (revenue, bookings, new customers) over a user-picked range (+150 more)

### Community 13 - "Community 13"
Cohesion: 0.02
Nodes (111): Automation trigger event registry (option label, raw event name, description), automation_runs table, automation_steps table, automation-test-run edge function (step-by-step timeline simulation), automations table, getReadingTime(), ToolbarButton(), Rental pricing tier logic (daily/weekly/monthly thresholds) (+103 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (73): formatDate(), calculateExtensionPrice(), findMatchingHoliday(), formatDate(), getDayRate(), parseDateString(), calculateRentalPriceBreakdown(), findMatchingHoliday() (+65 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (103): cms-media storage bucket, CMS draft-publish-version-rollback lifecycle, bonzah-calculate-premium edge function, cancel-booking-preauth edge function, cancel-rental-refund edge function, capture-booking-payment edge function, notify-booking-cancelled edge function, Unsaved-change detection via JSON snapshot plus beforeunload guard (+95 more)

### Community 16 - "Community 16"
Cohesion: 0.02
Nodes (100): Lead lifecycle stage machine (new to converted/lost/blacklisted), getApplyUrl(), getBookingBaseUrl(), getOfferUrl(), Apply and offer deep links from the portal into the customer booking app, Omnichannel conversation inbox (leads and customers, one thread across channels), create-offer-link edge function, create-preauth-checkout edge function (+92 more)

### Community 17 - "Community 17"
Cohesion: 0.03
Nodes (47): handleSubmit(), if(), create-boldsign-document edge function, send-signing-email edge function, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, eventDetail() (+39 more)

### Community 18 - "Community 18"
Cohesion: 0.03
Nodes (94): 12-hour date plus time picker for expense timestamps, Picks are assembled as local wall-clock Dates then serialised with toISOString (UTC on the wire), Database table: customers, Database table: enquiries, Database table: expense_categories, Database table: expenses, Database table: rentals, leads table (+86 more)

### Community 19 - "Community 19"
Cohesion: 0.03
Nodes (83): Booking site photo serving — the consumer of redacted_url, calculate-rental-price: the consumer that must reconcile base rate, surcharges and per-day overrides, Tenant currency convention: tenant?.currency_code with a hard-coded fallback in every vehicle panel, Vehicle detail page tab surface these panels compose into, Vehicle P&L ledger fed by service costs and disposal gain/loss, detect-plate-regions edge function (Trax plate detection), save-photo-redaction edge function, detect-plate-regions edge function (+75 more)

### Community 20 - "Community 20"
Cohesion: 0.03
Nodes (81): Vestigial DocuSign envelope status enum (platform e-sign is BoldSign), Portal domain status and category enumerations, Expense and payment type to P&L category mapping (constants.ts variant), Legacy 4-role enum omitting the manager role, Hardcoded Drive 247 company contact defaults in a multi-tenant app, Fine due-date and insurance-expiry business thresholds, Default locale/currency/timezone (en-US, USD, America/Chicago), React Query cache, refetch and retry policy defaults (+73 more)

### Community 21 - "Community 21"
Cohesion: 0.03
Nodes (80): Bonzah balance widget with configurable low-balance threshold, Test mode relabels the Bonzah balance as 'Allocated Balance' and stamps a TEST badge, Rationale: banner state defaults to dismissed so it never flashes before localStorage is read, Bonzah onboarding decision banner (approved / rejected), Rationale: approval dismissal is keyed per submission so a fresh activation shows again; a rejection is deliberately not dismissible until the operator re-submits, Per-tenant localStorage collapse state for the checklist, Coming-soon integration partition (Twilio, WhatsApp, CheckMyDriver driver + insurance), Tenant-initiated test/live mode switch and test-credit requests routed to the platform admin (+72 more)

### Community 22 - "Community 22"
Cohesion: 0.04
Nodes (49): add(), newRow(), toggleCustomer(), handleFile(), close(), handleFile(), reset(), runImport() (+41 more)

### Community 23 - "Community 23"
Cohesion: 0.03
Nodes (52): Byte-identical copy of the card-brand artwork module in the admin app, Card-brand alias normalisation across Stripe, Checkout and Billing Portal casings, cardBrandLabel(), Single canonical 'card on file' block reused by every billing surface, An expired card is styled as destructive because it is the reason the next renewal will fail, A card is valid through the last day of its expiry month; expiry is compared to the following month's first instant, formatCardExpiry(), formatMaskedCard() (+44 more)

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (48): handleSave(), onSave(), onSubmit(), advance(), dkey(), keyToDate(), project(), save() (+40 more)

### Community 25 - "Community 25"
Cohesion: 0.04
Nodes (58): cancel_installment_plan SQL function, go_live_requests table, inshur-check-eligibility edge function, Server-side INSHUR mode normalisation, inshur_rental_coverage table, inshur_vehicle_eligibility table, inshur-verify-credentials edge function, installment_notifications table (+50 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (52): About page story section authoring (title, founded year, rich body), Local-state mirroring convention: copy the content prop into useState and re-sync with useEffect, blog_categories table, Blog draft/published lifecycle with publisher attribution, Word count and 200-wpm reading-time estimation exported for reuse by blog pages, Long-form blog authoring surface (Tiptap: tables, code blocks, YouTube, alignment, highlight), blog_posts table, Per-post SEO controls (meta tags, canonical URL, noindex, reading time) (+44 more)

### Community 27 - "Community 27"
Cohesion: 0.04
Nodes (1): zod

### Community 28 - "Community 28"
Cohesion: 0.06
Nodes (45): How-It-Works step authoring with automatic renumbering on add/remove/reorder, Standard vs premium service-inclusions authoring for the rental marketing page, Presentational CMS editor contract: props {content, onSave, isSaving}, Website-content editor barrel (partial: exports 7 of 25 editors), Legal page authoring: title, last-updated date and rich HTML body, One component serves both /cms/privacy and /cms/terms via pageTitle/pageDescription props, Client-side canvas resize/scale of a tenant logo before upload, Shared `company-logos` Supabase storage bucket (bucket-wide DELETE for any authenticated user) (+37 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (33): Booking page header content (title, subtitle), cms_page_sections, Contact card content with call and email CTA labels, Contact form copy — subject options, success message and GDPR consent text, GDPR consent copy is mandatory on the public contact form, Contact channel content — phone, email, office address and WhatsApp, WhatsApp advertised as a customer contact channel, Fleet empty-state content with active-filter vs default title variants (+25 more)

### Community 30 - "Community 30"
Cohesion: 0.1
Nodes (15): @googlemaps/js-api-loader, PlacesSessionManager, fetchSuggestions(), handleFocus(), handleSelectSuggestion(), fetchSuggestions(), formatDistanceDisplay(), handleFocus() (+7 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (19): setTimeout(...,0) inside onAuthStateChange breaks a Supabase client deadlock, Collapsing every lookup failure to null caused an unrecoverable dashboard-login ping-pong, Tri-state profile load: ok / absent / unavailable, profileUnavailable means 'unknown', never 'denied' — a blip must not revoke a held profile, Typed 'profile_unavailable' error so the login page shows connection wording and writes no login_failed audit row, Portal staff authentication and session state, Auto-extending rentals stay Active regardless of a trailing end_date, calculateDuration() (+11 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (19): contrastRatio(), deepenUntilReadable(), hexToHslTriplet(), hexToRgb(), judgeBrandColor(), readableForegroundOn(), relativeLuminance(), rgbToHex() (+11 more)

### Community 33 - "Community 33"
Cohesion: 0.1
Nodes (22): AI call summary and extracted action items, Rationale: the AI summary is generated asynchronously after the call, taking 30-60s, so the dialog shows a pending state rather than an error, Copy-to-clipboard and .txt export of call transcript, Gotcha: call_logs is read through an untyped `supabase as any` cast, so the generated types do not cover it, Chat barrel splitting AI chatbot components from customer (human) chat components, Client-side Mermaid diagram rendering for AI answers, Diagram theme derived from the tenant accent colour, Rationale: mermaid.render needs an element already in the DOM in some versions, so a hidden off-screen div is created and torn down (+14 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (19): Category colours applied as inline styles to avoid Tailwind arbitrary-value safelisting, 'Your feedback' history view closes the loop so operators do not submit twice then give up, page_path stays a clean route; entry source rides its own column so GROUP BY on page still works, Clipboard paste-to-attach because screenshots land on the clipboard, not on disk, Form is cleared only after a successful send so a failed insert never eats the typed paragraph, Stamp 'prompted' on dialog open, not on submit, Screenshot PII caution: attachments are visible to the Drive247 team, Single in-portal feedback capture surface (+11 more)

### Community 35 - "Community 35"
Cohesion: 0.17
Nodes (16): Customer review history surfaced inline during booking approval decisions, customer_review_summaries table (AI-generated per-customer summary), Client-side average/count fallback when the AI summary row is missing, Reviews are fetched only while the dialog is open (customerId passed as undefined when closed), Full per-customer review history with deep link to the reviewed rental, generate-review-summary edge function (OpenAI customer review summary), Review dialog impression is written to the audit log on open, Internal 1-10 customer rating with tags, comment, skip and edit (+8 more)

### Community 36 - "Community 36"
Cohesion: 0.23
Nodes (9): getStatusIcon(), getStatusVariant(), InspectionRegistrationStatusChip(), formatDueStatusText(), getDueStatus(), getStatusIcon(), getStatusVariant(), Vehicle warranty expiry status chip (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.14
Nodes (14): Blocked-date overlap enforcement for rental dates, checkBlockedDatesOverlap(), Extras total with per-day billing expansion, getGlobalBlockedDates(), getVehicleBlockedDates(), normalizeDate(), parseLocalDate(), Rationale: extras day-count must match the algorithm used at rental creation or a DST crossing drifts from what was charged (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (2): Drawer(), vaul

### Community 39 - "Community 39"
Cohesion: 0.21
Nodes (13): Inline image ingestion for blog posts via paste, drag-drop and file picker, Hard-coded 10MB / image-only upload limits duplicated across three uploaders, Legacy image-only hero carousel manager (upload, URL add, reorder, cap), Centralised CMS_MEDIA size/type limits (10MB image, 50MB video, 10 items, GIF treated as video), Mixed image+video hero carousel manager with per-type validation and hover video preview, Fleet hero still wired to the image-only carousel while Home hero moved to mixed media — the two heroes have drifted, cms-media public storage bucket shared by every CMS uploader, Hero background image source picker: upload to storage or paste an external URL (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.2
Nodes (12): aws-ses-email edge function, aws-sns-sms edge function, Transactional email delivery via AWS SES edge function, Admin email read from process.env in browser code, falling back to a hardcoded address, Email/SMS failures are swallowed so other channels still fire, Multi-channel staff notification orchestration (in-app + email + SMS), Parallel all-channel dispatch via Promise.allSettled, Services layer convention — orchestrators with side effects, unlike pure lib utilities (+4 more)

### Community 41 - "Community 41"
Cohesion: 0.24
Nodes (9): ai-document-ocr edge function, pdfjs-dist, pdf.js worker loaded from a CDN to avoid Next.js bundler complications, pdfToImage(), Canvas filled white first so transparent PDF areas render correctly, handleFiles(), onDrop(), reset() (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (11): 100 free credits granted for completing both migration tasks, Two-variant gate: soft (dismissible, 24h suppression) vs hard (Esc/outside-click blocked, only completion exits), Rationale: deliberately light-mode only with literal colours so the prompt looks identical for every operator regardless of theme, Stated reason: Stripe now requires rental platforms in the region to settle through an account the operator owns, Operator prompt to migrate onto a self-owned Stripe Connect account, Subscription gate dialog — soft (never subscribed) vs hard (expired / past_due) gating, Rationale: absolute canonical URLs are required because the portal runs on {tenant}.portal.drive-247.com; the portal's own /terms is retired and 307s, Single shared platform Terms of Service + Privacy acceptance checkbox (+3 more)

### Community 43 - "Community 43"
Cohesion: 0.22
Nodes (11): admin-force-logout edge function, verify-session edge function, Instant path: realtime broadcast eviction on tenant and platform auth channels, Rationale: broadcast (not postgres_changes) so eviction never depends on the supabase_realtime publication, Rationale: every ambiguous or failed check fails OPEN so a working operator is never logged out, Bulletproof force-logout listener for portal staff, Rationale: re-validate when the async auth store finally hydrates, or the reopen backstop never runs, Rationale: deleting auth.sessions does not invalidate the JWT already in the browser (+3 more)

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (11): vehicle-files private storage bucket, vehicle-photos public storage bucket, vehicle_files table, Client-side MIME allowlist plus 25MB size cap on vehicle document upload, Vehicle document vault (upload, list, download, delete), Rationale: the uploaded storage object is deleted when the metadata insert fails, so no orphan files accumulate, Private-bucket download through a one-hour signed URL, Storage deletion failure is logged and swallowed because the object may already be gone (+3 more)

### Community 45 - "Community 45"
Cohesion: 0.39
Nodes (7): begin(), draw(), getCtx(), handleClear(), onResize(), pointFromEvent(), setupCanvas()

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (6): formatFileSize(), getMaxFileSize(), getMediaTypeFromUrl(), handleAddUrl(), handleFileUpload(), isVideoType()

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (9): Auto-refill threshold and top-up amount settings, Post-checkout success polling while the credit purchase webhook settles, Rationale: 5-credit minimum mirrors CREDIT_CONFIG.MIN_PURCHASE_CREDITS because the AED credits account cannot settle sub-200-fils Stripe totals, Platform-ToS consent gate on credit purchase, Rationale: /credits is whitelisted past the subscription paywall, so a tenant with no plan could be charged having accepted nothing; the gate fails closed while the query is in flight, Live-only credit usage chart with time range and service filter, Credit usage chart rebuilt on the analytics page, Credit usage analytics (+1 more)

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (3): formatEmailCurrency(), getEmailTemplateType(), getVariablesForTemplateType()

### Community 49 - "Community 49"
Cohesion: 0.32
Nodes (3): addFiles(), handleDrop(), handleFileChange()

### Community 50 - "Community 50"
Cohesion: 0.36
Nodes (5): applyPrices(), clearCustom(), clearSelection(), isSelectable(), toggleDay()

### Community 51 - "Community 51"
Cohesion: 0.52
Nodes (5): minimumTierLabel(), planNameHasFeature(), resolveTier(), tierMeetsRequirement(), useFeatureAccess()

### Community 52 - "Community 52"
Cohesion: 0.43
Nodes (7): AI damage analysis comparing handover photos against return photos, Photos sorted by uploaded_at exactly as the edge function does, so finding indices resolve to the right images, Stale-report detection when photo counts no longer match the stored report, detect-vehicle-damage edge function, Sticky 'complete key handover' nudge that switches tab then scrolls to the section, Key-handover photo grid — multi-upload, zoom, delete-with-confirm, 10 photo / 10MB caps, rental_handover_photos table

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (7): Rationale: anchor clicks are caught in the capture phase to beat the Next.js Link handler, Rationale: ref mirror of dialog state plus a 350ms cooldown prevents the guard re-triggering itself, Rationale: dialog open is deferred via queueMicrotask because Next.js 16 calls pushState inside useInsertionEffect where state updates are forbidden, Unsaved-changes navigation guard across four interception surfaces, Rationale: on popstate the URL has already changed, so the original URL is pushed back to undo back/forward, history.pushState monkey-patch to intercept programmatic router.push navigation, Save-then-navigate path that only leaves when the caller's save resolves true

### Community 54 - "Community 54"
Cohesion: 0.4
Nodes (2): getDefaultKey(), parseValue()

### Community 55 - "Community 55"
Cohesion: 0.53
Nodes (5): commit(), handleInputBlur(), handleInputChange(), normalizeHex(), toHex6()

### Community 56 - "Community 56"
Cohesion: 0.33
Nodes (6): Inclusions icon-name catalogue (PascalCase lucide names), Service-highlights icon-name catalogue (PascalCase lucide names), Stats icon-name catalogue (lowercase keys), Icon-name casing diverges across CMS editors: PascalCase, lowercase and kebab-case coexist for the same lucide icons, Trust-badge icon-name catalogue (kebab-case keys, e.g. check-circle), Why-Choose-Us icon-name catalogue (lowercase keys)

### Community 58 - "Community 58"
Cohesion: 0.4
Nodes (5): check-policy-acceptance edge function, Acceptance check fails open so an edge-function error never locks staff out, Hardcoded Supabase URL and anon key fallback for the raw gate fetch, Portal staff privacy-policy and terms acceptance gate, Super admins clear the gate in the frontend only, with no DB acceptance record

### Community 59 - "Community 59"
Cohesion: 0.4
Nodes (5): Duration discounts (min_duration_days > 0) auto-apply and cannot be entered as promo codes, Negotiated manual extension price replaces the auto price and disables promo stacking, Promo code applied to the extension rental fee, with tax and fee recomputed on the discounted base, Promo and duration discounts never carry into auto-extension renewal cycles, promocodes table

### Community 60 - "Community 60"
Cohesion: 0.4
Nodes (5): owner_payouts table (payouts owed to third-party vehicle owners), Outstanding balance derived client-side as net_owed minus amount_paid, Date filter matches overlapping payout periods (period_end >= from, period_start <= to), Third-party vehicle-owner payout CSV export, vehicle_owners table (third-party owner contact details)

### Community 61 - "Community 61"
Cohesion: 0.4
Nodes (5): PLATFORM_TOS_URL shown by Stripe when consent_collection is enabled, platform-tos.test.ts asserts the three legal-URL definitions agree, Absolute URLs are required: on {tenant}.portal.drive-247.com a root-relative /terms can never reach the marketing site, Canonical platform ToS / privacy URLs, One definition because these are consent links: a partial origin override left mandatory-acceptance screens silently pointing at production

### Community 62 - "Community 62"
Cohesion: 0.4
Nodes (5): setup setup, vitest config bookingtestharness, Test-time '@' alias must mirror the app's tsconfig alias or every module mock breaks, Portal unit-test harness: jsdom, global APIs, shared setup file, Convention: tests live only in src/__tests__ and are excluded from coverage

### Community 63 - "Community 63"
Cohesion: 0.5
Nodes (1): @radix-ui/react-aspect-ratio

### Community 64 - "Community 64"
Cohesion: 0.5
Nodes (4): 307 not 308 - a permanent redirect cannot be recalled from users' caches, Portal legal routes redirect to the marketing site, Redirect rather than delete: the login page's mandatory acceptance checkbox links here, Only one operator-to-Drive247 terms document may exist

### Community 65 - "Community 65"
Cohesion: 0.5
Nodes (4): Caller ID mode on forwarded calls — show the caller or show the business line, Per-user forwarding number row, now unrendered dead UI, Inbound calls ring the browser and every configured phone at once; first to answer wins, Per-team-member forwarding numbers were removed in favour of one main number

### Community 66 - "Community 66"
Cohesion: 0.5
Nodes (4): rental-insights edge function, AI-generated fleet utilisation insights, One OpenAI call per tenant per 10 minutes, shared across pages, Insight payload capped at 30 rentals to stay within token limits

### Community 67 - "Community 67"
Cohesion: 0.5
Nodes (4): E-sign usage normalised into the generic UsageCategoryData shape, Rationale: an event counts as reported only when stripe_event_id is set, i.e. Stripe's meter accepted it, Rationale: every category hook is called unconditionally to satisfy the rules of hooks, Pluggable usage-metering category registry (esign today, sms planned)

### Community 68 - "Community 68"
Cohesion: 0.5
Nodes (4): blog_post_versions table, Blog post version snapshots (numbered, with author and metadata), cms_page_versions table, CMS page version snapshots with notes and author

### Community 69 - "Community 69"
Cohesion: 0.5
Nodes (4): create-additional-drivers edge function, send-additional-driver-invite edge function, Additional-driver creation and verification/signing invite dispatch, Rationale: additional-driver creation and invites are non-fatal because the rental row is already committed and the tooling is independent of it

### Community 70 - "Community 70"
Cohesion: 0.67
Nodes (2): tailwindcss, tailwindcss-animate

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (1): @radix-ui/react-collapsible

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (3): Customer testimonials management surface, Marketing testimonial CRUD for the tenant website, testimonials table

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (3): ai-draft-message edge function, AI-drafted outbound message by intent (welcome, doc_request, approval, offer, followup, decline), Rationale: window.confirm is intentional — a Radix modal would add 3 round-trips of UX state for a one-time guard

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (3): Setup-nudge interlock: Bonzah/Stripe-Connect reminder suppressed for exactly the celebration window, SUCCESS_LINGER_MS — migration success celebration window, Success state latched by wasOpenRef so the celebration only fires for operators who saw the prompt

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (3): Call recording with AI transcript, summary and action items behind a spoken consent notice, Voicemails and AI transcripts land back in the customer's conversation thread, Two-minute voicemail capture with a default greeting

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (3): Shared empty-state pattern (icon, title, description, optional action), Shared breadcrumb navigation trail with current-page emphasis, Table-cell truncation that reveals the full value in a click-toggled tooltip

### Community 78 - "Community 78"
Cohesion: 0.67
Nodes (3): Global validation limits (8-char password, min rental age 21), Login rate-limit and lockout defaults, Portal login form email/password field validation

### Community 79 - "Community 79"
Cohesion: 0.67
Nodes (3): sync-tesla-charges edge function, tesla_supercharger_charges table, Tesla Fleet vehicles get a live Supercharger charge sync folded into the return summary

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (3): sync-tesla-charges edge function, tesla_supercharger_charges table, Tesla Supercharger charge reconciliation and rebilling to the renter

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (3): Rationale: FeedbackSource literals must mirror the tenant_feedback.source CHECK constraint or the insert fails, Feedback entry-point provenance (sidebar / rental_close / forced), tenant_feedback table

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (2): Rental status to colour mapping (picker list), Rental status to colour mapping (own-message vs received variant)

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (2): Inline Twilio and WhatsApp brand SVGs (small variant), Inline Twilio and WhatsApp brand SVGs (full variant)

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (2): auto_extension_reminders table, Auto-extension pay-link reminder cadence, cap, weekday and history log

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (2): Free-form tags promoted into the tenant's shared review-tag vocabulary on the fly, review_tags table (per-tenant review tag vocabulary)

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (2): Role-ungated feedback entry point in sidebar footer, Rationale: gating feedback on permissions would silence the viewers who use the software most

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (2): CMS media upload size/type/bucket defaults, CMS media constraints (carousel cap, video types, optimisation)

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (2): mounted ref guards setState after unmount on a promise that outlives the component, Module-level singleton Google Maps Places loader shared by every consumer

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (2): rental_extensions table, Extension links are the only ones with a stored reusable customer URL, joined from rental_extensions

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (2): Rate limiting temporarily disabled to fix login — every method is a no-op, Login attempt rate limiting

### Community 94 - "Community 94"
Cohesion: 1.0
Nodes (2): calculate_vehicle_book_cost SQL function, Book-cost calculation used to preview disposal gain/loss

### Community 95 - "Community 95"
Cohesion: 1.0
Nodes (2): Portal next.config.js legal redirects (mirror of the canonical URLs), Mirrored (not imported) in next.config.js, which cannot import from src/ — kept in step by a parity test

### Community 96 - "Community 96"
Cohesion: 1.0
Nodes (2): supabase-js returns early without clearing storage on a failed logout, so the user silently signs back in, Local-scope sign-out that manually purges the stored Supabase token

### Community 97 - "Community 97"
Cohesion: 1.0
Nodes (2): cms_media table, Tenant CMS media library (foldered uploads with alt text)

### Community 98 - "Community 98"
Cohesion: 1.0
Nodes (2): formatTimeOfDay(), Pickup / return location card with copyable maps link

### Community 99 - "Community 99"
Cohesion: 1.0
Nodes (2): delete_rental_cascade Postgres function, Cascade deletion of a rental and its related records

### Community 100 - "Community 100"
Cohesion: 1.0
Nodes (2): Booking-side booking-notice and rental-duration limit checks, Soft lead-time, minimum and maximum duration warnings with admin override

### Community 102 - "Community 102"
Cohesion: 1.0
Nodes (1): TypeScript build errors ignored because Supabase types drift from the schema

### Community 103 - "Community 103"
Cohesion: 1.0
Nodes (1): Hardcoded AWS SES/SNS account config shipped in the client bundle

### Community 104 - "Community 104"
Cohesion: 1.0
Nodes (1): Portal route path constants

## Ambiguous Edges - Review These
- `isMoneyReceived()` → `formatters.formatCurrency prints Math.abs(amount), so negative/credit amounts lose their sign`  [AMBIGUOUS]
  apps/portal/src/lib/payment-status.ts · relation: conceptually_related_to
- `extractInvokeError()` → `Bulk retry of insurance policies stuck on insufficient allocated balance`  [AMBIGUOUS]
  apps/portal/src/hooks/use-cmd-verification.ts · relation: conceptually_related_to
- `Blog visibility switch that shows or hides the blog on the booking website` → `tenants table (branding and operational settings)`  [AMBIGUOUS]
  apps/portal/src/app/(dashboard)/cms/blog/page.tsx · relation: writes_table
- `Rationale: auto_allocate_payments_on_new_charge drains ledger remaining_amount to zero, so open payg_accruals are the source of truth for PAYG outstanding` → `Ledger-only balance status used by the analytics donut`  [AMBIGUOUS]
  apps/portal/src/app/(dashboard)/customers/analytics/page.tsx · relation: conceptually_related_to
- `Customer insurance policy compliance tracking` → `Unified insurance register across Bonzah, INSHUR and uploaded policies`  [AMBIGUOUS]
  apps/portal/src/app/(dashboard)/documents/page.tsx · relation: semantically_similar_to
- `Vehicle detail & per-vehicle P&L workspace` → `Fast-forward one rental's cron clock by N days`  [AMBIGUOUS]
  apps/portal/src/app/api/dev/sandbox/route.ts · relation: conceptually_related_to
- `Insurer-mandated Bonzah addendum injected for Bonzah tenants` → `Static Figma-token preview of the Bonzah insurance settings screen`  [AMBIGUOUS]
  apps/portal/src/app/payment-preview/page.tsx · relation: conceptually_related_to
- `Portal 404 page` → `Portal provider chain (query, tenant, realtime chat, auth, theme)`  [AMBIGUOUS]
  apps/portal/src/app/not-found.tsx · relation: conceptually_related_to
- `ledger_entries table` → `Manual/offline payment recording against a customer, outside the Stripe flow`  [AMBIGUOUS]
  apps/portal/src/client-schemas/shared/add-payment-dialog.ts · relation: writes_table
- `Customer document upload with type, expiry and vehicle association` → `E-signature lifecycle badge: pending / sent / delivered / signed / completed / declined / voided`  [AMBIGUOUS]
  apps/portal/src/components/customers/add-customer-document-dialog.tsx · relation: conceptually_related_to
- `Collect first, decide later: money lands on the customer account as unallocated credit` → `Gotcha: the default payment date is pinned to America/New_York regardless of tenant locale`  [AMBIGUOUS]
  apps/portal/src/components/customers/collect-payment-dialog.tsx · relation: rationale_for
- `Reuses the full rentals calendar's bar geometry and RentalBar for a one-day mini timeline` → `Vehicle photo resolution: lowest display_order in vehicle_photos, else vehicles.photo_url`  [AMBIGUOUS]
  apps/portal/src/components/dashboard/fleet-overview.tsx · relation: semantically_similar_to
- `Live progress and result of AI verification of an uploaded insurance certificate` → `Attach typed supporting documents to an insurance policy`  [AMBIGUOUS]
  apps/portal/src/components/insurance/document-upload-dialog.tsx · relation: conceptually_related_to
- `Hard DELETE of the lead row straight from the workspace menu` → `conversations table (one per lead)`  [AMBIGUOUS]
  apps/portal/src/components/leads/lead-workspace.tsx · relation: shares_data_with
- `Known lead-message variable vocabulary (offer_link, deposit_link, agreement_link, lockbox_code …)` → `lockbox_templates table (same {{variable}} placeholder vocabulary)`  [AMBIGUOUS]
  apps/portal/src/components/leads/lead-composer.tsx · relation: semantically_similar_to
- `Rationale: maintenance block defaults to today→+7d, not the rental end date` → `Rationale: a disabled <fieldset> blocks nested controls for mouse and keyboard while leaving saved config untouched`  [AMBIGUOUS]
  apps/portal/src/components/rentals/swap-vehicle-dialog.tsx · relation: semantically_similar_to
- `Bonzah partner application form contract` → `Strict hex while typing, forgiving hex on blur — a half-typed value is never committed`  [AMBIGUOUS]
  apps/portal/src/components/settings/color-picker.tsx · relation: semantically_similar_to
- `Pre-cancellation preview of Bonzah policies to cancel and unpaid Insurance ledger charges to write off (premium refund subject to Bonzah approval)` → `Customer insurance certificate upload (PDF only, 10MB) into customer-documents storage`  [AMBIGUOUS]
  apps/portal/src/components/shared/dialogs/insurance-upload-dialog.tsx · relation: conceptually_related_to
- `Single-date popover picker control` → `Unsaved-changes navigation guard with Cancel / Discard / Save-and-leave`  [AMBIGUOUS]
  apps/portal/src/components/shared/forms/date-picker-input.tsx · relation: conceptually_related_to
- `Bonzah insurance float balance chip with low-balance (<$50) warning` → `Portal dashboard chrome shell (sidebar + global header + AI chat sidebar)`  [AMBIGUOUS]
  apps/portal/src/components/shared/layout/layout.tsx · relation: conceptually_related_to
- `Credit wallet balance chip (live vs test credits) linking to /credits` → `Portal dashboard chrome shell (sidebar + global header + AI chat sidebar)`  [AMBIGUOUS]
  apps/portal/src/components/shared/layout/layout.tsx · relation: conceptually_related_to
- `Rental selection dialog shared by insurance issuance and agreement generation` → `Documented mode filter (Active/Confirmed, future end_date, no PAYG, 90d completed) is not applied by the query`  [AMBIGUOUS]
  apps/portal/src/components/shared/rental-picker.tsx · relation: conceptually_related_to
- `Purchase vs Finance acquisition badge with P&L tooltip` → `Plate unassign writes a vehicle_events row typed 'expense_added'`  [AMBIGUOUS]
  apps/portal/src/components/vehicles/enhanced-vehicle-plates-panel.tsx · relation: conceptually_related_to
- `Per-photo number plate redaction editor` → `Physical licence-plate order tracking per vehicle (ordered / received / fitted)`  [AMBIGUOUS]
  apps/portal/src/components/vehicles/vehicle-plates-panel.tsx · relation: conceptually_related_to
- `Vehicle photo gallery: multi-upload, drag reorder, delete, banner selection` → `Spare key custody indicator: company vs customer, with holder notes`  [AMBIGUOUS]
  apps/portal/src/components/vehicles/spare-key-chip.tsx · relation: conceptually_related_to
- `Vestigial DocuSign envelope status enum (platform e-sign is BoldSign)` → `Per-tenant rental agreement template management`  [AMBIGUOUS]
  apps/portal/src/constants/constants.ts · relation: conceptually_related_to
- `Drive247-branded default privacy policy and terms-of-service copy` → `Customer-facing visibility flags (hide registration, hide price breakdown, theme mode)`  [AMBIGUOUS]
  apps/portal/src/constants/website-content.ts · relation: conceptually_related_to
- `Sequential bulk messaging across many customer channels` → `Audit action and entity-type taxonomy`  [AMBIGUOUS]
  apps/portal/src/hooks/use-audit-log.ts · relation: conceptually_related_to
- `Active-template exclusivity enforced by client-side deactivate-then-activate writes` → `Fleet-wide and per-vehicle availability blackouts`  [AMBIGUOUS]
  apps/portal/src/hooks/use-agreement-templates.ts · relation: semantically_similar_to
- `Audit action and entity-type taxonomy` → `Blog taxonomy CRUD with slug generation and post counts`  [AMBIGUOUS]
  apps/portal/src/hooks/use-blog-categories.ts · relation: references
- `Submit fires AI verdict and partner email best-effort so neither can block the application` → `Verification magic link delivered over email / SMS / WhatsApp with a resend path`  [AMBIGUOUS]
  apps/portal/src/hooks/use-cmd-verification.ts · relation: semantically_similar_to
- `Omnichannel operator inbox across in-app, SMS, WhatsApp, email and voice` → `Trax AI staff assistant conversation with sources, charts and rental requests`  [AMBIGUOUS]
  apps/portal/src/hooks/use-chat.ts · relation: conceptually_related_to
- `Portal convention: every React Query key is namespaced by tenant?.id and gated on enabled: !!tenant` → `Maintenance banner surfacing (platform-global plus per-tenant)`  [AMBIGUOUS]
  apps/portal/src/hooks/use-maintenance-banner.ts · relation: conceptually_related_to
- `Portal convention: every React Query key is namespaced by tenant?.id and gated on enabled: !!tenant` → `768px mobile breakpoint detection for responsive portal chrome`  [AMBIGUOUS]
  apps/portal/src/hooks/use-mobile.tsx · relation: conceptually_related_to
- `Portal convention: every React Query key is namespaced by tenant?.id and gated on enabled: !!tenant` → `Client-side RBAC gating for managers and read-only roles`  [AMBIGUOUS]
  apps/portal/src/hooks/use-manager-permissions.ts · relation: conceptually_related_to
- `Resolve the active rental linking one customer to one vehicle` → `Gap: this rental lookup carries no tenant_id filter and no tenant-scoped query key, unlike every sibling hook`  [AMBIGUOUS]
  apps/portal/src/hooks/use-customer-vehicle-rental.ts · relation: rationale_for
- `Internal-only lead notes, pinned first — never sent to the lead` → `Per-tenant lead message templates (sms/email/whatsapp) for the composer's template picker`  [AMBIGUOUS]
  apps/portal/src/hooks/use-lead-templates.ts · relation: semantically_similar_to
- `Lead pipeline feed for kanban and list views` → `Lead search across raw name, email and phone columns`  [AMBIGUOUS]
  apps/portal/src/hooks/use-leads.ts · relation: conceptually_related_to
- `Maintenance banner surfacing (platform-global plus per-tenant)` → `Organisation settings read/write through the `settings` edge function`  [AMBIGUOUS]
  apps/portal/src/hooks/use-org-settings.ts · relation: semantically_similar_to
- `Rationale: tab-visibility refetch works around browser throttling of background-tab timers` → `Voice token lifecycle: tokenWillExpire handler plus a scheduled 50-minute refresh ahead of the 1-hour expiry`  [AMBIGUOUS]
  apps/portal/src/hooks/use-unread-count.ts · relation: semantically_similar_to
- `Coupling: disposal posts to the P&L ledger, so pnlEntries and the vehicle timeline are invalidated` → `Gotcha: services invalidate ['plEntries', vehicleId] while disposal invalidates ['pnlEntries'] - two spellings of the same ledger cache`  [AMBIGUOUS]
  apps/portal/src/hooks/use-vehicle-services.ts · relation: references
- `Gotcha: disposal invalidates ['vehicleEvents', vehicleId] but the events hook keys ['vehicleEvents', tenantId, vehicleId] - the prefix never matches` → `Vehicle lifecycle event timeline (typed events with polymorphic reference_table)`  [AMBIGUOUS]
  apps/portal/src/hooks/use-vehicle-disposal.ts · relation: references
- `Owner commission model: percentage vs flat fee with a period, plus payout frequency` → `stack_surcharges: additive stacking of all applicable surcharges vs highest-only, off by default`  [AMBIGUOUS]
  apps/portal/src/hooks/use-vehicle-owners.ts · relation: conceptually_related_to
- `Vehicle primary photo upload, replace and removal` → `Gotcha: photo mutations invalidate ['vehicles-list'] while sibling vehicle hooks invalidate ['vehicles']`  [AMBIGUOUS]
  apps/portal/src/hooks/use-vehicle-photo.ts · relation: references
- `Tenant email template merge-variable catalogue and per-template allowlist` → `email_templates table`  [AMBIGUOUS]
  apps/portal/src/lib/email-template-variables.ts · relation: governs
- `org_settings table (per-tenant operational settings incl. timezone)` → `Rental & booking operational settings form — one ~45-field state object covering tax, fees, deposits, durations, lockbox, PAYG, auto-extend and blog`  [AMBIGUOUS]
  apps/portal/src/app/(dashboard)/settings/page.tsx · relation: shares_data_with
- `Portal design tokens bridged from CSS custom properties into Tailwind` → `Portal base sans stack is Playfair Display serif, diverging from the loaded Inter face`  [AMBIGUOUS]
  apps/portal/tailwind.config.ts · relation: conceptually_related_to

## Knowledge Gaps
- **1386 isolated node(s):** `Only one operator-to-Drive247 terms document may exist`, `Redirect rather than delete: the login page's mandatory acceptance checkbox links here`, `307 not 308 - a permanent redirect cannot be recalled from users' caches`, `TypeScript build errors ignored because Supabase types drift from the schema`, `Deno edge functions import from esm.sh so Vitest cannot import them` (+1381 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 27`** (50 nodes): `getToday()`, `getToday()`, `getToday()`, `zod`, `add-customer-document.ts`, `customer-form-modal.ts`, `expense.ts`, `authority-payment.ts`, `fine-appeal.ts`, `complete-job.ts`, `maintenance-rule.ts`, `record-odometer.ts`, `report-issue.ts`, `schedule-maintenance.ts`, `insurance-policy.ts`, `add-plate.ts`, `assign-plate.ts`, `enhanced-add-plate.ts`, `enhanced-assign-plate.ts`, `close-rental.ts`, `protection-plan-dialog.ts`, `add-fine-dialog.ts`, `add-payment-dialog.ts`, `add-service-record.ts`, `add-vehicle-dialog.ts`, `edit-vehicle-enhanced.ts`, `edit-vehicle.ts`, `vehicle-disposal.ts`, `vehicle-expense.ts`, `booking-header-editor.ts`, `contact-card-editor.ts`, `contact-form-editor.ts`, `contact-info-editor.ts`, `empty-state-editor.ts`, `extras-editor.ts`, `faqs-manager.ts`, `fleet-hero-editor.ts`, `hero-section-editor.ts`, `home-cta-editor.ts`, `home-hero-editor.ts`, `how-it-works-editor.ts`, `inclusions-editor.ts`, `promo-badge-editor.ts`, `promotions-hero-editor.ts`, `rental-rates-editor.ts`, `seo-editor.ts`, `service-highlights-editor.ts`, `terms-editor.ts`, `testimonials-header-editor.ts`, `trust-badges-editor.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (13 nodes): `cn()`, `Drawer()`, `DrawerClose()`, `DrawerDescription()`, `DrawerFooter()`, `DrawerHeader()`, `DrawerOverlay()`, `DrawerPortal()`, `DrawerTitle()`, `DrawerTrigger()`, `vaul`, `drawer.tsx`, `drawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (6 nodes): `cn()`, `getDefaultKey()`, `handleCountrySelect()`, `handleNumberChange()`, `parseValue()`, `phone-input.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `AspectRatio()`, `@radix-ui/react-aspect-ratio`, `aspect-ratio.tsx`, `aspect-ratio.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (3 nodes): `tailwindcss`, `tailwindcss-animate`, `tailwind.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (3 nodes): `Collapsible()`, `@radix-ui/react-collapsible`, `collapsible.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (2 nodes): `Rental status to colour mapping (picker list)`, `Rental status to colour mapping (own-message vs received variant)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (2 nodes): `Inline Twilio and WhatsApp brand SVGs (small variant)`, `Inline Twilio and WhatsApp brand SVGs (full variant)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (2 nodes): `auto_extension_reminders table`, `Auto-extension pay-link reminder cadence, cap, weekday and history log`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (2 nodes): `Free-form tags promoted into the tenant's shared review-tag vocabulary on the fly`, `review_tags table (per-tenant review tag vocabulary)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (2 nodes): `Role-ungated feedback entry point in sidebar footer`, `Rationale: gating feedback on permissions would silence the viewers who use the software most`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (2 nodes): `CMS media upload size/type/bucket defaults`, `CMS media constraints (carousel cap, video types, optimisation)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (2 nodes): `mounted ref guards setState after unmount on a promise that outlives the component`, `Module-level singleton Google Maps Places loader shared by every consumer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (2 nodes): `rental_extensions table`, `Extension links are the only ones with a stored reusable customer URL, joined from rental_extensions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (2 nodes): `Rate limiting temporarily disabled to fix login — every method is a no-op`, `Login attempt rate limiting`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (2 nodes): `calculate_vehicle_book_cost SQL function`, `Book-cost calculation used to preview disposal gain/loss`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (2 nodes): `Portal next.config.js legal redirects (mirror of the canonical URLs)`, `Mirrored (not imported) in next.config.js, which cannot import from src/ — kept in step by a parity test`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (2 nodes): `supabase-js returns early without clearing storage on a failed logout, so the user silently signs back in`, `Local-scope sign-out that manually purges the stored Supabase token`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (2 nodes): `cms_media table`, `Tenant CMS media library (foldered uploads with alt text)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (2 nodes): `formatTimeOfDay()`, `Pickup / return location card with copyable maps link`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 99`** (2 nodes): `delete_rental_cascade Postgres function`, `Cascade deletion of a rental and its related records`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (2 nodes): `Booking-side booking-notice and rental-duration limit checks`, `Soft lead-time, minimum and maximum duration warnings with admin override`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (1 nodes): `TypeScript build errors ignored because Supabase types drift from the schema`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (1 nodes): `Hardcoded AWS SES/SNS account config shipped in the client bundle`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (1 nodes): `Portal route path constants`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `isMoneyReceived()` and `formatters.formatCurrency prints Math.abs(amount), so negative/credit amounts lose their sign`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `extractInvokeError()` and `Bulk retry of insurance policies stuck on insufficient allocated balance`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Blog visibility switch that shows or hides the blog on the booking website` and `tenants table (branding and operational settings)`?**
  _Edge tagged AMBIGUOUS (relation: writes_table) - confidence is low._
- **What is the exact relationship between `Rationale: auto_allocate_payments_on_new_charge drains ledger remaining_amount to zero, so open payg_accruals are the source of truth for PAYG outstanding` and `Ledger-only balance status used by the analytics donut`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Customer insurance policy compliance tracking` and `Unified insurance register across Bonzah, INSHUR and uploaded policies`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Vehicle detail & per-vehicle P&L workspace` and `Fast-forward one rental's cron clock by N days`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Insurer-mandated Bonzah addendum injected for Bonzah tenants` and `Static Figma-token preview of the Bonzah insurance settings screen`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._