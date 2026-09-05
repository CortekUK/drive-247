# Graph Report - web  (2026-09-04)

## Corpus Check
- 88 files · ~70,281 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 446 nodes · 790 edges · 18 communities detected
- Extraction: 84% EXTRACTED · 15% INFERRED · 1% AMBIGUOUS · INFERRED: 118 edges (avg confidence: 0.79)
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
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 10 edges
2. `callFunction()` - 10 edges
3. `Single /strategy-call conversion endpoint hardcoded across every marketing section` - 10 edges
4. `Drive247 platform Terms of Service — the 50-section contract between Cortek Systems Ltd and subscribing rental operators` - 10 edges
5. `Strategy-call qualifier intake (source=strategy-call)` - 9 edges
6. `Single source of truth for all marketing landing-page copy (no CMS, no DB — copy ships in the bundle)` - 9 edges
7. `Appendix A platform Terms of Service renderer` - 8 edges
8. `POST()` - 7 edges
9. `normalizeEmail()` - 7 edges
10. `validateAccount()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `getStripeJs()` --calls--> `GET()`  [INFERRED]
  apps/web/src/components/onboarding/steps/payment-step.tsx → apps/web/src/app/api/strategy-call/booking/route.ts
- `useFadeIn()` --semantically_similar_to--> `Scroll-spy: highlights the nav link whose section is currently in view`  [INFERRED] [semantically similar]
  apps/web/src/hooks/use-fade-in.ts → apps/web/src/hooks/use-active-section.ts
- `Qualifier answer option sets (fleet size, platform, source, budget, readiness)` --semantically_similar_to--> `Landing-page consultation qualifier form (native selects)`  [INFERRED] [semantically similar]
  apps/web/src/app/strategy-call/page.tsx → apps/web/src/components/forms/consultation-form.tsx
- `SubscribeDonePage()` --calls--> `json()`  [INFERRED]
  apps/web/src/app/subscribe/[token]/done/page.tsx → apps/web/src/app/api/strategy-call/events/route.ts
- `callFunction()` --calls--> `GET()`  [INFERRED]
  apps/web/src/components/onboarding/onboarding-api.ts → apps/web/src/app/api/strategy-call/booking/route.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (9): class-variance-authority, clsx, radix-ui, react, react-dom, @stripe/react-stripe-js, @stripe/stripe-js, tailwind-merge (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (21): allowedUrlHosts(), getStrategyCallBookingSummary(), safeProviderUrl(), crypto, dotenv, next, ConfirmationPage(), Shell() (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (48): Effect depends on an animate-aurora keyframe and Tailwind v4 --color-* variables defined outside this file; removing either kills the visual silently, Animated aurora gradient backdrop for the hero, Direct booking channel pitch — branded site, real-time availability, insurance and ID at checkout, Infinite marquee of headline trust metrics, Zero-commission / customer-data-ownership positioning claim, Bottom-of-page conversion band, Single /strategy-call conversion endpoint hardcoded across every marketing section, Disclaimer that campaigns run through the operator's own ad accounts, retaining ownership and data (+40 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (42): Landing-page consultation qualifier form (native selects), Footer legal navigation to privacy, terms and security, Footer conversion CTA into the strategy-call funnel, Shared marketing chrome (header + footer), Meta/Facebook Pixel marketing attribution and domain verification, Organization + SoftwareApplication JSON-LD structured data, OpenGraph and Twitter card share metadata, Distraction-free chrome for the strategy-call funnel (logo only, no nav) (+34 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (36): Product tour slides with paired light/dark screenshots and video assets (image/imageDark, video/videoDark), Sales objection handling: not-a-marketplace, Meta ads support, own-domain, 7-day launch, you keep your customers, GoHighLevel (LeadConnector) strategy-call booking widget — the primary CTA destination, an external funnel outside Supabase, Single source of truth for all marketing landing-page copy (no CMS, no DB — copy ships in the bundle), Primary nav anchors (#features, #timeline, #pricing, #faq), Marketed capability list — the public promise of what the platform ships (Stripe payments, Bonzah insurance, roles, chat, P&L), Anti-marketplace problem framing: customer ownership, 15-30% commissions, hidden brand, SEO / OpenGraph metadata positioning Drive247 as a direct-booking platform for US operators (+28 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (27): focusFirst(), handleCreateAccount(), handleGoogle(), handleSignIn(), handleTenantSubmit(), tenantErrors(), tenantValues(), tenantValuesFrom() (+19 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (24): previewEnabled(), SignupPreviewPage(), fleetBandTop(), isSignupPlanId(), reportPlanCatalogueProblems(), fetchSignupPlans(), readNumber(), readString() (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (6): CTABand(), lucide-react, FAQSection(), PricingSection(), Rationale: observer disconnects on first intersection so a revealed section never fades back out or replays on scroll-up, useFadeIn()

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (23): getBrowserSupabase(), @supabase/supabase-js, authHeaders(), callFunction(), codeFromStatus(), fetchSignupMeta(), isKnownCode(), OnboardingApiError (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (16): createEmptyProgress(), createEmptyVideoProgress(), makeEventId(), parseBookingSummary(), poll(), readStoredProgress(), sendFunnelEvent(), sendWhenVisible() (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (10): parseVtt(), toSeconds(), fs, path, url, vitest, getAllowedGhlOrigins(), isTrustedGhlCompletionMessage() (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (5): Boolean(), draftFromSnapshot(), resultFromDetail(), resultFromMeta(), stripTrailingSlash()

### Community 13 - "Community 13"
Cohesion: 0.29
Nodes (1): next-themes

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (2): eslint, eslint-config-next

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (2): appendOnce(), prewarmStripeJs()

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (3): main#main — the skip link's landing target, Strategy-call layout's main has no id, so the global skip link has no target there, Skip-to-content accessibility anchor targeting #main

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (2): TypeScript build errors ignored for the web app, Monorepo root pins @types/react@18 while web runs React 19

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (2): Ideal-customer qualification stated in the hero: established US operators, 5+ vehicles, already taking bookings, Built-for list restating the ideal customer profile (Turo power hosts, airport/local fleets, paid-traffic operators)

## Ambiguous Edges - Review These
- `Post-booking confirmation and expectation-setting page` → `Fully open crawl policy plus sitemap pointer`  [AMBIGUOUS]
  apps/web/src/app/robots.ts · relation: conceptually_related_to
- `Platform holds no client funds and is not a payment intermediary` → `Landing hero value proposition: own your bookings, grow beyond marketplaces`  [AMBIGUOUS]
  apps/web/src/components/sections/hero.tsx · relation: conceptually_related_to
- `Twelve-month fee liability cap plus no-warranty / as-available disclaimer` → `Public performance guarantee: not live in 7 days means month one is not charged`  [AMBIGUOUS]
  apps/web/src/components/sections/timeline.tsx · relation: conceptually_related_to
- `Canonical marketing site URL https://drive247.co` → `Rationale: the contract lives in apps/web because drive-247.com/terms is its canonical public home — the portal's second copy is retired and 307s here`  [AMBIGUOUS]
  apps/web/src/lib/constants.ts · relation: conceptually_related_to
- `Clickwrap acceptance clause (Sections 38-39): creating an account or clicking 'I Agree' carries the effect of a handwritten signature` → `Lazy anon Supabase singleton for the marketing site — public anon key only, no tenant context and no service role`  [AMBIGUOUS]
  apps/web/src/lib/legal/platform-tos.ts · relation: conceptually_related_to
- `contact_requests table — the marketing site's single inbox for email leads and strategy-call requests` → `Lead record shape (id, email, created_at, source) for marketing capture`  [AMBIGUOUS]
  apps/web/src/types/index.ts · relation: reads_table
- `Lead record shape (id, email, created_at, source) for marketing capture` → `Lead's field shape does not match what the site actually persists — every capture path inserts into contact_requests (contact_name/company_name/email/status) instead`  [AMBIGUOUS]
  apps/web/src/types/index.ts · relation: references

## Knowledge Gaps
- **35 isolated node(s):** `Qualifier answer option sets (fleet size, platform, source, budget, readiness)`, `Deliberate omissions: retention for account data, lawful bases, sub-processor list, transfer mechanism, rights procedure`, `Rendered ToS must move in lockstep with the version stamped at subscription checkout`, `Booking app /terms is a different renter-to-operator contract — never cross-link`, `The old 8-section marketing summary had no payment terms, governing law, liability cap or warranty disclaimer` (+30 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 13`** (7 nodes): `next-themes`, `JsonLd()`, `RootLayout()`, `layout.tsx`, `json-ld.tsx`, `theme-provider.tsx`, `ThemeProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (3 nodes): `eslint.config.mjs`, `eslint`, `eslint-config-next`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (3 nodes): `stripe-prewarm.ts`, `appendOnce()`, `prewarmStripeJs()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `TypeScript build errors ignored for the web app`, `Monorepo root pins @types/react@18 while web runs React 19`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `Ideal-customer qualification stated in the hero: established US operators, 5+ vehicles, already taking bookings`, `Built-for list restating the ideal customer profile (Turo power hosts, airport/local fleets, paid-traffic operators)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Post-booking confirmation and expectation-setting page` and `Fully open crawl policy plus sitemap pointer`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Platform holds no client funds and is not a payment intermediary` and `Landing hero value proposition: own your bookings, grow beyond marketplaces`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Twelve-month fee liability cap plus no-warranty / as-available disclaimer` and `Public performance guarantee: not live in 7 days means month one is not charged`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Canonical marketing site URL https://drive247.co` and `Rationale: the contract lives in apps/web because drive-247.com/terms is its canonical public home — the portal's second copy is retired and 307s here`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Clickwrap acceptance clause (Sections 38-39): creating an account or clicking 'I Agree' carries the effect of a handwritten signature` and `Lazy anon Supabase singleton for the marketing site — public anon key only, no tenant context and no service role`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `contact_requests table — the marketing site's single inbox for email leads and strategy-call requests` and `Lead record shape (id, email, created_at, source) for marketing capture`?**
  _Edge tagged AMBIGUOUS (relation: reads_table) - confidence is low._
- **What is the exact relationship between `Lead record shape (id, email, created_at, source) for marketing capture` and `Lead's field shape does not match what the site actually persists — every capture path inserts into contact_requests (contact_name/company_name/email/status) instead`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._