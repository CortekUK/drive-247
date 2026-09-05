# Graph Report - scripts  (2026-09-04)

## Corpus Check
- 31 files · ~32,834 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 259 nodes · 473 edges · 13 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 79 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `log()` - 36 edges
2. `Full demo dataset for the Bonzah tenant — branding, locations, fleet, customers, rentals, payments, fines, expenses, P&L` - 18 edges
3. `main()` - 14 edges
4. `push()` - 14 edges
5. `One-shot tenant provisioning from the onboarding sheet — fills the tenants row and (optionally) CMS copy, locations, FAQs, testimonials and extras for both portal and booking site` - 13 edges
6. `tenants table` - 12 edges
7. `onboard()` - 11 edges
8. `Notification branding regression harness — invokes eight notify-* edge functions with synthetic payloads to prove they use tenant branding instead of hardcoded values` - 11 edges
9. `Nuclear reset — deletes every row from ~50 tables including tenants and app_users` - 10 edges
10. `Seeds 100 vehicles chosen to be insurable under Bonzah, with generated UK-style plates, VINs and full mileage/deposit config` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Service-role key must come from .env and never be committed — the runbook's only security instruction` --conceptually_related_to--> `Production Supabase URL and keys (anon in five scripts, service_role in two) are literal constants in committed source rather than env vars`  [INFERRED]
  scripts/README.md → scripts/seed-vehicles.ts
- `main()` --calls--> `log()`  [INFERRED]
  scripts/seed-vehicles.mjs → scripts/sim/helpers.mjs
- `main()` --calls--> `log()`  [INFERRED]
  scripts/create-site-settings-page.js → scripts/sim/helpers.mjs
- `seedVehicles()` --calls--> `log()`  [INFERRED]
  scripts/seed-vehicles.ts → scripts/sim/helpers.mjs
- `main()` --calls--> `log()`  [INFERRED]
  scripts/seed-100-bonzah-vehicles.mjs → scripts/sim/helpers.mjs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (25): childEnv(), runFreeze(), runVerify(), status(), stub(), grep(), main(), violationsFor() (+17 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (44): Logo/favicon upload to the company-logos storage bucket with timestamped filenames as cache-busting, Bulk multi-tenant branding rollout — one JSON config drives palette, SEO and contact updates across many tenants, Service-role client with autoRefreshToken/persistSession off, deliberately bypassing tenant RLS for cross-tenant writes, The tenants-row branding column family (primary/secondary/accent x light+dark, header_footer, logo_url, favicon_url, meta_title/description, app_name), Bootstraps the tenant's 'site-settings' CMS page — the container the footer/logo/social CMS layer writes into, notify-booking-approved edge function, notify-booking-cancelled edge function, notify-booking-pending edge function (+36 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (43): accrue-payg-charges edge function, MOT and road-tax due-date backfill — randomises dates across overdue/upcoming so compliance alerts have data, Vehicle gallery backfill — inserts one vehicle_photos row per seeded make/model, skipping vehicles that already have photos, Production keys are never hard-coded: first staging switch copies .env.local to .env.local.prod.bak, and 'prod' just restores that backup, Point portal/booking/admin/web at the staging Supabase clone or back at production by rewriting each .env.local, Staging Supabase project ref ksmreaadhbirzakkxqrq — the constant that identifies 'not production', Two independent production guards: an exact-hostname sentinel that throws at import time, and sim-control itself 403ing off-staging, Thin client for the staging-only sim-control edge function — list/shift/fire, the shared engine behind both the terminal harness and the DevPanel Time Machine (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (28): ADD(), BREAK(), byName(), emit(), header(), line(), push(), tpush() (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (12): main(), randomDate(), main(), jspdf, @supabase/supabase-js, main(), makeReceiptPdf(), main() (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.2
Nodes (16): buildPalette(), fmtPhoneDisplay(), generateContent(), hexToHsl(), hslToHex(), lightenForDark(), loadEnvFile(), main() (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.36
Nodes (8): write(), findListeners(), fetchSet(), get(), getAll(), has(), save(), sleep()

### Community 7 - "Community 7"
Cohesion: 0.33
Nodes (7): getContentType(), main(), updateTenantBranding(), uploadFile(), dotenv, generateContent(), main()

### Community 8 - "Community 8"
Cohesion: 0.38
Nodes (4): api(), authAdmin(), ensureAuthUser(), sql()

### Community 9 - "Community 9"
Cohesion: 0.43
Nodes (5): process, call(), fire(), list(), shift()

### Community 10 - "Community 10"
Cohesion: 0.47
Nodes (3): invokeFunction(), runTests(), testFunction()

### Community 11 - "Community 11"
Cohesion: 0.4
Nodes (4): ., date-fns-tz, build(), fail()

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (2): Frees dev ports 3000-3005 before every dev server start, so no app ever falls through to an alternate port, lsof exits non-zero when nothing is listening — the empty catch is intentional, not a swallowed error

## Knowledge Gaps
- **31 isolated node(s):** `Operator runbook for the bulk tenant branding rollout (config shape, logo folder, colour/SEO field reference)`, `Logo/favicon upload to the company-logos storage bucket with timestamped filenames as cache-busting`, `Frees dev ports 3000-3005 before every dev server start, so no app ever falls through to an alternate port`, `lsof exits non-zero when nothing is listening — the empty catch is intentional, not a swallowed error`, `Bonzah underwriting exclusion list encoded as data: no Ferrari/Lamborghini/Bentley/Porsche etc., and per-model carve-outs (no Corvette, no Cybertruck)` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 12`** (2 nodes): `Frees dev ports 3000-3005 before every dev server start, so no app ever falls through to an alternate port`, `lsof exits non-zero when nothing is listening — the empty catch is intentional, not a swallowed error`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 3` to `Community 0`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 9`, `Community 10`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Why does `tenants table` connect `Community 1` to `Community 2`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `Full demo dataset for the Bonzah tenant — branding, locations, fleet, customers, rentals, payments, fines, expenses, P&L` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `log()` (e.g. with `testFunction()` and `runTests()`) actually correct?**
  _`log()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `Full demo dataset for the Bonzah tenant — branding, locations, fleet, customers, rentals, payments, fines, expenses, P&L` (e.g. with `Seeds 100 vehicles chosen to be insurable under Bonzah, with generated UK-style plates, VINs and full mileage/deposit config` and `Inserts in chunks of 25 to stay under PostgREST payload limits, reporting per-chunk instead of failing the whole batch`) actually correct?**
  _`Full demo dataset for the Bonzah tenant — branding, locations, fleet, customers, rentals, payments, fines, expenses, P&L` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `push()` (e.g. with `getAll()` and `fetchSet()`) actually correct?**
  _`push()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Operator runbook for the bulk tenant branding rollout (config shape, logo folder, colour/SEO field reference)`, `Logo/favicon upload to the company-logos storage bucket with timestamped filenames as cache-busting`, `Frees dev ports 3000-3005 before every dev server start, so no app ever falls through to an alternate port` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._