# TRAX local operational milestone

Historical milestone. The current Responses API, fleet tools, persistent support package, user-approved retention defaults and latest activation limits are in [support-escalation.md](support-escalation.md). The provider protocol/configuration and test counts below describe this earlier milestone, not the final package.

Repository review date: 2026-09-15. Knowledge 0.2.0; source base commit and working-tree hashes are in knowledge-manifest.json. Release mapping is unverified, review remains pending, and no deployment or migration was performed. This supersedes the historical Phase 0/1 implementation report only for this approved local milestone.

## Implemented and offline-tested

- Retains the V2 launcher, layout, account boundary, navigation registry, knowledge build and fallback. V1 chat and all calendars remain untouched.
- Adds a server-side model adapter and bounded tool orchestrator shared by the Next development route and edge entry. The existing repository uses OpenAI gpt-4o over Chat Completions. TRAX reuses that protocol without invoking `_shared/openai.ts`, whose usage-log inserts would violate this milestone's no-write boundary.
- Exact reviewed-section retrieval replaces phrase ranking as the primary path when the model is configured. Prepared guidance remains explicitly labelled fallback for absent/failed model service. There is no automatic choice of a new provider or silent outbound private-data access.
- Three narrow read tools resolve authorized vehicle/rental identifiers, read rental/receiving context and diagnose V2 website visibility/date occupancy or checkout prechecks. All use allowlisted columns and bounded queries. Per-tool authorization, source validation, conflict handling and restricted summaries are enforced outside the prompt.
- Extracts side-effect-free V2 rules into `v2/apps/web/src/lib/vehicles/availability-rules.ts`, consumed by the existing V2 hooks/checkout precheck and generated for the backend. No pricing, scheduling policy, database trigger or calendar behavior is changed.
- Encrypted bounded context supports follow-ups without stored legacy history. Check Again fetches fresh evidence. UI distinguishes model/fallback answers, shows canonical findings and coverage limits, and keeps permission-checked navigation.

The request path is `useTraxSupport` → local `/api/trax-support` (development only) / dedicated edge endpoint → `handleSupportRequest` → `authorize` + validated page → `modelConversation` → exact knowledge/navigation or `OPERATIONAL_TOOLS` → `createOperationalReads` + shared V2 predicates → model explanation → validated sources/actions + canonical evidence → authorization recheck → response. Database/model credentials never reach the browser or model tool arguments.

## Provider configuration and integration evidence

Candidate provider/model: OpenAI / gpt-4o, matching the existing repository integration. Required server-only values: OPENAI_API_KEY, TRAX_MODEL, TRAX_MODEL_DATA_POLICY. No values are documented or logged. The data-policy flag is an explicit operator approval gate, not a setting this implementation enables automatically.

At implementation time the Supabase public/server configuration was present in the git-ignored local environment. Bounded connectivity/auth checks succeeded and an invalid bearer returned 401 from the local route. The approved model key/policy configuration was absent. A real signed-in browser session is not available to the automated fixture harness. **No authenticated real-model/live-record diagnostic is claimed.** The pending provider/data-policy decision and private key setup are required before that integration test.

## Verification record

The new `trax-operational.test.ts` suite passed 66 isolated cases, covering model/tool orchestration, metadata/URL rejection, provider errors, query caps, identity/permission checks, restrictions, return conflicts, PAYG discrepancy, null end dates, ambiguous records, multiple blockers, buffers/timezones and attempted forbidden tools. The six targeted suites total 169 passing tests (66 operational, 61 support, 17 hook, 15 local-route, four session and six knowledge).

The existing Phase 1 suites are retained. Their request-size assertion now targets the new bounded 16 KiB envelope needed for encrypted short conversation context; the message limit remains 4,000 characters. The baseline still checks V1 file hashes, manager permissions, tenant switches, access revocation, unsupported actions, local-only route behavior and prepared fallback.

Browser commands: `node tests/trax/browser.mjs` and `node tests/trax/browser.mjs --operational`. Both mount the real V2 launcher/dialog/hook and shared handler in an isolated browser. The operational variant injects anonymized reads and a **scripted model**; it is not a real provider integration. Its recheck simulates a completed rental return with a remaining fleet-wide block. Screenshots are local artifacts under `artifacts/trax-operations/desktop.png` and `mobile.png`; no production records or credentials appear. Language-quality/paraphrase examples in scripted tests verify plumbing, not actual model understanding.

Focused strict TypeScript checks pass for the backend shared code and development route. The complete V2 web TypeScript check also passes. The broader portal compiler terminated with exit 134 before emitting diagnostics in this environment, so a clean whole-portal build is not claimed. A subsequent focused UI compile reported seven errors; an in-memory compile of the original HEAD versions reproduced the same seven (existing Radix ref/button types, TenantContext query types and auth-store return type). No new focused UI type errors were found.

## Remaining verification and scope limits

1. Obtain explicit approval for the provider and minimal operational data policy, configure its key privately, restart, and perform the signed-in V2 steps in local-testing.md. Record only request ID, HTTP status, tool/model counts, timestamps and redacted conclusions.
2. Evaluate actual English/Roman Urdu understanding, follow-ups, safe abstention and latency/cost using the real approved model. No accuracy percentage or cost estimate has been inferred from scripted tests.
3. Checkout diagnosis deliberately remains partial. The deployed overlap trigger and additional customer/draft/write-time rules are not validated through a mutating trial booking. Other booking channels and broader application modules remain unverified/partial.
4. The knowledge inventory still has 39 features: six verified at their narrow documented scope, four partial, 28 requiring confirmation, one unsupported. Availability remains partial; adding tests does not promote entire workflows or certify deployed release parity.
5. Stripe, payments, financial entitlements, production deployment, migrations and all business mutations remain outside this milestone.

The implementation is reviewable locally. The milestone's required signed-in/model/live-read outcome remains unverified until the configuration and account integration steps actually succeed.
