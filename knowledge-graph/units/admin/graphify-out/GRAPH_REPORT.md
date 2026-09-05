# Graph Report - admin  (2026-09-04)

## Corpus Check
- 95 files · ~144,272 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 742 nodes · 1498 edges · 28 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 183 edges (avg confidence: 0.82)
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

## God Nodes (most connected - your core abstractions)
1. `tenants table` - 34 edges
2. `app_users table` - 18 edges
3. `One-form sales onboarding: tenant, branding, credits, CMS content and paywall in one step` - 15 edges
4. `loadSubscription()` - 14 edges
5. `DashboardPage()` - 13 edges
6. `tenant_subscriptions table` - 13 edges
7. `Cross-tenant security-deposit hold health monitor` - 13 edges
8. `load()` - 12 edges
9. `Rental companies (tenant) listing` - 12 edges
10. `tenant_subscription_invoices table` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Credit pricing table: $0.20 per credit, 1000 default test credits, e-sign 7 / Twilio 2 / license verification 31 credits` --semantically_similar_to--> `Authoritative credit pricing consumed by the credit-deduction and credit-checkout edge functions`  [INFERRED] [semantically similar]
  apps/admin/lib/credit-config.ts → supabase/functions/_shared/credit-config.ts
- `Duplicate-resend warning driven by brandon_sent_at` --shares_data_with--> `tenants table`  [AMBIGUOUS]
  apps/admin/components/admin/SendToBrandonDialog.tsx → apps/admin/app/admin/(protected)/rentals/page.tsx
- `Multi-currency formatting with a USD/GBP/EUR locale map and USD as platform base currency` --semantically_similar_to--> `formatByCurrency()`  [INFERRED] [semantically similar]
  apps/admin/lib/utils.ts → apps/admin/app/admin/(protected)/rentals/page.tsx
- `loadSubscription()` --invokes--> `apply-subscription-discount edge function — get/apply/remove a one-time Stripe coupon`  [EXTRACTED]
  apps/admin/app/admin/(protected)/rentals/[id]/page.tsx → supabase/functions/apply-subscription-discount/index.ts
- `handleDelete()` --invokes--> `admin-delete-tenant edge function — cascade delete with per-table deletionResults`  [EXTRACTED]
  apps/admin/app/admin/(protected)/rentals/[id]/page.tsx → supabase/functions/admin-delete-tenant/index.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (36): load(), removeQuestion(), removeVideo(), for(), formatBytes(), class-variance-authority, clsx, jspdf (+28 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (56): admin-create-user edge function, admin-delete-tenant edge function — cascade delete with per-table deletionResults, apply-subscription-discount edge function — get/apply/remove a one-time Stripe coupon, Rationale: slug-derived first-login password, forced reset via must_change_password, Compensating tenant row delete when admin-create-user fails, Manual tenant plus head-admin provisioning, recharts, manage-subscription-plans edge function — plan CRUD and Stripe Price minting (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (60): admin_settings table, contact_requests table, go_live_requests table, mark-invoice-paid edge function, onboarding-daily-digest edge function, Global flags are fanned out to every admin_settings row because readers evaluate them as 'true if ANY row is true', At-risk revenue counts past_due, unpaid and terminal-with-open-invoice, so involuntary churn is not mistaken for voluntary churn, Bonzah onboarding folded into the unified Onboarding page (+52 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (36): admin_todo_comments, admin_todos table — per-tenant super-admin kanban cards (status, position, assignee, image), AdminTodosTab(), authstore appusersprivilegelookup, authstore superadminaccessgate, date-fns, @dnd-kit/core, @dnd-kit/sortable (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (42): check-migration-readiness edge function, create-uae-subscription-capture edge function, credit_transactions, Cross-tenant security-deposit hold health monitor, Rationale: de-duplicate parallel reads on id and discount the overlap from server counts, or a status flip double-counts a rental, Rationale: dead holds on ended rentals rank last and leave the attention counters; a LIVE hold on an ended rental is not dormant, Rationale: NON_TERMINAL_HOLD_STATUSES deliberately copied from tenant-payments-tab; this copy is the cross-tenant contract if they diverge, Rationale: three-day expiry warning window matches the portal rental page so both surfaces agree on 'soon' (+34 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (39): bonzah_onboarding_submissions table, bonzah_quiz_questions table, bonzah_training_videos table, Quiz question authoring with correct-option marking, Bonzah training video and quiz content administration, Training video catalog CRUD with sort order and active flag, Approve/reject submission with tenant-visible admin note, Submission image bundle ZIP export (JSZip) (+31 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (38): Per-tenant internal todo board tab, Rationale: cards created here are visible only on this tenant's detail page, Admin identity avatar with initials fallback (assignees and comment authors), carousel images editor hardcodedmedialimits, lead board column droptarget, lead board kanbanpipeline, page promotion image upload, Priority visual tokens (dot and pill) for low/medium/high (+30 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (35): admin-create-sales-agent edge function, admin-force-logout edge function, Primary-super-admin-only administration of super admin accounts, app_users table, Portal staff authentication store (app_users, tenant-scoped RBAC), Session restore with privilege re-verification on every load, Dual privilege model: super admin OR sales agent may enter admin, Rationale: supabase client cast to any because is_sales_agent is absent from the generated Supabase types (+27 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (31): blocked_identities table, customers table, global_blacklist table, manage-global-blacklist edge function, Blocked customers across every tenant, Global blacklist entries persist after a tenant unblocks, so the page unions blocked customers with blacklist-only emails, Booking volume (GMV) across tenants, not Drive247 income, DashboardPage() (+23 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (30): audit_logs table, feedback-insights edge function, feedback-screenshots private storage bucket, openai_usage_logs table, Per-call AI cost telemetry sliced by edge function, tenant and model, Platform audit action vocabulary and badge severity mapping, Filtered audit-log CSV export with 1000-row batching, No FK joins on audit_logs: duplicate FK constraints on tenant_id make PostgREST ambiguous, so actors and tenants are batch-resolved client-side (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (26): asBullets(), asNullableNumber(), asNullableString(), asNumber(), asString(), callPlansFn(), handleConfirmPrice(), handleSaveContent() (+18 more)

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (16): archive(), load(), remove(), reorder(), save(), saveFaq(), saveGroup(), saveSection() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (4): nextjs-toploader, detectPlatform(), getPushCapability(), isStandalone()

### Community 13 - "Community 13"
Cohesion: 0.17
Nodes (9): cn(), formatByCurrency(), formatMinor(), getSubStatus(), handleMarkPaid(), isEndingSoon(), isVerificationCharge(), nextInvoiceDue() (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.26
Nodes (9): buildDefaultPassword(), handleCreateTenant(), validateSlug(), handleCountryChange(), handleProviderChange(), isCountrySupported(), optionFor(), paymentProviderTenantColumns() (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.27
Nodes (8): buildOperatingHoursText(), handleSubmit(), isEmail(), isHttpUrl(), isPhone(), normalizeSlug(), timeLabel(), validateSlug()

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (6): authstore salesagentuntypedcast, components admin mobileheader tsx, Admin builds fail on TypeScript errors (ignoreBuildErrors: false), unlike booking and portal, SidebarProvider(), 768px mobile breakpoint detection driving the admin sidebar/drawer layout, useIsMobile()

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (7): announcement-media storage bucket, feature_announcement_stats view, feature_announcements table, Announcement reach: seen and dismissed counts, Severity decides surfacing: major = modal + drawer, minor = drawer only, Feature announcements admin, Platform-wide what's-new broadcast to customers of every tenant

### Community 18 - "Community 18"
Cohesion: 0.47
Nodes (3): getAuthHeaders(), handleConfirmAction(), loadBlockedCustomers()

### Community 19 - "Community 19"
Cohesion: 0.47
Nodes (3): cardBrandLabel(), formatMaskedCard(), normalizeCardBrand()

### Community 20 - "Community 20"
Cohesion: 0.5
Nodes (3): fetchData(), handleAdjust(), flipPaymentModel()

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (4): postcss-load-config, Tailwind + autoprefixer CSS build pipeline for the admin app, tailwind config neonpurpleadmintheme, cn()

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (4): Credit pricing is triplicated (admin, portal, edge _shared); the admin copy has zero importers and omits MIN_PURCHASE_CREDITS, Credit pricing table: $0.20 per credit, 1000 default test credits, e-sign 7 / Twilio 2 / license verification 31 credits, credit config getservicecost, Authoritative credit pricing consumed by the credit-deduction and credit-checkout edge functions

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (2): exportCSV(), GET()

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (2): tailwindcss, tailwindcss-animate

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (3): Development-only floating quick-nav panel (NODE_ENV gated, Ctrl+Shift+D), Clear localStorage and sessionStorage then reload (blows away the cached admin session), Admin sidebar open/close state

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (2): Announcement preview as the operator will see it, Coupling: announcement body_html is injected unescaped via dangerouslySetInnerHTML — authoring surface is trusted

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (2): Admin dashboard loading placeholder, Generic admin table loading placeholder

## Ambiguous Edges - Review These
- `tenants table` → `Duplicate-resend warning driven by brandon_sent_at`  [AMBIGUOUS]
  apps/admin/components/admin/SendToBrandonDialog.tsx · relation: shares_data_with
- `Admin sidebar open/close state` → `Development-only floating quick-nav panel (NODE_ENV gated, Ctrl+Shift+D)`  [AMBIGUOUS]
  apps/admin/components/admin/SidebarContext.tsx · relation: conceptually_related_to
- `Rationale: supabase client cast to any because is_sales_agent is absent from the generated Supabase types` → `is_sales_agent present in generated Supabase types for app_users`  [AMBIGUOUS]
  apps/admin/src/integrations/supabase/types.ts · relation: conceptually_related_to

## Knowledge Gaps
- **93 isolated node(s):** `Admin app root layout with DevPanel and toast host`, `Bonzah onboarding folded into the unified Onboarding page`, `Exact per-mode counts use head-count queries so the 10k row ceiling cannot skew them`, `Severity decides surfacing: major = modal + drawer, minor = drawer only`, `announcement-media storage bucket` (+88 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 23`** (3 nodes): `route.ts`, `exportCSV()`, `GET()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (3 nodes): `tailwindcss`, `tailwindcss-animate`, `tailwind.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `Announcement preview as the operator will see it`, `Coupling: announcement body_html is injected unescaped via dangerouslySetInnerHTML — authoring surface is trusted`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `Admin dashboard loading placeholder`, `Generic admin table loading placeholder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `tenants table` and `Duplicate-resend warning driven by brandon_sent_at`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `Admin sidebar open/close state` and `Development-only floating quick-nav panel (NODE_ENV gated, Ctrl+Shift+D)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Rationale: supabase client cast to any because is_sales_agent is absent from the generated Supabase types` and `is_sales_agent present in generated Supabase types for app_users`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `tenants table` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.243) - this node is a cross-community bridge._
- **Why does `app_users table` connect `Community 7` to `Community 1`, `Community 2`, `Community 3`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `DashboardPage()` connect `Community 8` to `Community 1`, `Community 2`, `Community 7`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `tenants table` (e.g. with `v_tenant_onboarding_status view` and `v_tenant_readiness view`) actually correct?**
  _`tenants table` has 4 INFERRED edges - model-reasoned connections that need verification._