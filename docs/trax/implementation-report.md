> Historical Phase 0/1 report. Current local changes and verification limits are in [completion-status.md](completion-status.md).

# TRAX Phase 0/1 implementation and verification

Local implementation completed on 2026-09-12 against audited base commit `13f9ea8679fbc6e35940b7d5824efa77b9da4b2d`, on the existing `main` branch. Changes remain uncommitted and ready for review. No application release or production deployment match is asserted. The unrelated document lock file was preserved.

The rollout scope is **V2 tenants only**: Northwind Rentals now, and future rental tenants when enabled for V2. The existing `chrome` gate controls the dedicated launcher, hook and `trax-support` endpoint; there is no permanent Northwind name check or separate TRAX tenant list. V2's existing **Ask AI** sidebar action opens the one mounted assistant; Ctrl/Cmd+J also works. V1's chat UI, hook, endpoint, types and indexers retain their original content, checked against `tests/trax/v1-baseline.json`. V1 tenants cannot call the new endpoint, including through a super-admin session. V1 remains a read-only reference for functionality and documentation.

## Implemented behavior and changed files

| Area | Changes | Actual behavior |
| --- | --- | --- |
| Operator endpoint | `supabase/functions/trax-support/index.ts`, `trax-support/support/{auth,conversation,handler,registry,types}.ts` | Authenticated staff membership establishes tenant and permissions. Active tenant status, manager grants, ownership, navigation and conversation scope are checked server-side. Only two named read-only tools are registered. |
| Prepared knowledge | `TRAX_APPLICATION_CONTEXT.md`, `docs/trax/`, `scripts/trax-knowledge.mjs`, `trax-support/support/*.generated.*`, root `AGENTS.md` | Ten prepared English/Roman Urdu guidance sections, 13 navigation targets, source hashes, route/permission coverage and change-driven maintenance rules. Runtime uses bounded section lookup; it does not scan the repository or call a model. |
| V2 TRAX interface | `apps/portal/src/hooks/use-trax-support.ts`, `lib/trax-session.ts`, `types/trax-support.ts`, `components/trax/support/{TraxSupportDialog,ChatMessage}.tsx`, `components/trax/trax-launcher.tsx`, dashboard layout | Guidance and provenance labels, working permission-checked navigation, access/error states, browser-memory conversations, cancellation and rejection of late responses after context changes. The existing V2 Ask AI control is connected to the new assistant. Missing or non-V2 context fails closed. The original V2 rollout registry is reused unchanged. |
| Legacy retrieval isolation | Dedicated `supabase/functions/trax-support/`; proposal `docs/trax/deferred/restrict-legacy-retrieval.sql` | The new endpoint does not read old embeddings/history/metrics or dispatch legacy actions. Global legacy remediation is deferred outside deployable migrations because it would change V1. V1/indexer files are unchanged. |
| Shared quote repair | `scripts/sync-fleet-quote.mjs`, `apps/portal/src/__tests__/lib/fleet-quote-sync.test.ts` | Restored source-driven generator and strict check mode. Only CRLF/LF transport differences are normalized; source bodies, dependency rewrites and currency helpers remain checked. No price or availability business logic was changed. |
| Verification | `trax-support.test.ts`, `trax-session.test.ts`, `trax-knowledge.test.ts`, `hooks/use-trax-support.test.tsx`, `tests/trax/browser.mjs`, `trax-support/tsconfig.offline.json`, `apps/portal/tsconfig.check.json` | Offline security, source/schema checks, client isolation, rendering and strict backend type checks. Explicit Deno import extensions are supported by the portal check config. |

The tools are `search_application_knowledge` and `resolve_navigation_target`. Record checks select only `id` and `tenant_id`; they do not inspect operational status, notes or finances. Access is rechecked before each response and navigation click. Requests accept at most 8 KiB, questions at most 4,000 characters, request-body reads at most five seconds, and database fetches share an eight-second deadline. Retrieval returns at most three eligible sections and the response uses one, with at most two navigation buttons. There are no automatic retries or unbounded record searches.

Conversation tokens last 30 minutes and bind the previous section/language to authenticated user, tenant, effective access and the prepared artifact. The token contains no messages. Closing or resetting the dialog clears its browser messages. New server logs contain request ID, response status and duration only. No prompt is sent to a model provider; provider policy and server conversation retention remain unresolved.

## Audit findings that still applied

The original V1 operator chat accepts client tenant/conversation context into a service-role retrieval path, queries legacy metrics and stored conversations, and can dispatch the reminder-writing tool. V2 uses the separate bounded contract above. V1 and its known audit concerns remain unchanged; fixing legacy access globally requires separate review. The reminder UI and domain functions elsewhere remain intact.

Existing `rag_documents`, `rag_sync_queue`, `chat_messages`, `match_documents`, `get_chat_history` and `get_rag_metrics` still require deployed access/retention review. `_shared/document-loaders.ts` includes sensitive account fields and record free text. Those stores were not read, deleted, rebuilt or reindexed during this implementation. Local isolation does not demonstrate that deployed access has changed.

The original synchronization failures were reproduced: the generator file was missing, and Windows CRLF prevented the LF-only source marker from being found. Both are fixed. All three synchronization tests now pass, as do the 44 existing fleet quote tests. Checked-in generated business files were not fabricated or rewritten.

The unavailable-car workflow is documented, including incomplete returns and other applicable blockers. Availability implementations and deployed trigger definitions need further characterization before a live diagnostic is approved. Existing Stripe helpers include mutations and historical platform/account ambiguity; none is exposed by Phase 1. See the [availability guide](workflows/vehicle-availability.md), [developer finance reference](developer/finances.md) and [manual diagnostic playbook](troubleshooting/vehicle-not-bookable.md).

## Coverage

The [generated inventory](generated/coverage-report.json) covers 86 portal page routes and all 24 current top-level permission keys across 39 feature entries:

| Status | Count | Scope |
| --- | ---: | --- |
| Verified | 6 | Narrow documented guidance/navigation for rentals, returns, customers, vehicles, reminders and templates. This does not certify every native operation. |
| Partially documented | 4 | Availability, messages, website content and settings; only reviewed prepared sections are retrieved. |
| Requiring confirmation | 28 | Financial modules, insurance/agreements, leads/enquiries/automations, staff/audit, owners, integrations, reports, fleet administration and the remaining catalogued modules. |
| Unsupported | 1 | Developer tools are intentionally excluded from operator support. |

The [feature catalog](feature-catalog.json) lists every entry and its limitations. Booking, platform admin and marketing applications remain separate unverified surfaces. Complete application coverage is explicitly false. Knowledge version is `0.1.0`; review is pending, application release is null, and production release verification is false.

## Exact local checks and results

From the repository root:

```powershell
node scripts/sync-fleet-quote.mjs --check
node scripts/trax-knowledge.mjs --build
node scripts/trax-knowledge.mjs --check
node node_modules/typescript/bin/tsc -p supabase/functions/trax-support/tsconfig.offline.json --pretty false
node tests/trax/browser.mjs
git -c core.safecrlf=false diff --check
```

The generator, local preparation/staleness checks, strict backend core type check, browser smoke test and whitespace check pass. The local knowledge build does not publish or contact a service.

From `apps/portal`:

```powershell
npm.cmd run test -- src/__tests__/lib/trax-support.test.ts src/__tests__/lib/trax-session.test.ts src/__tests__/hooks/use-trax-support.test.tsx src/__tests__/lib/trax-knowledge.test.ts src/__tests__/lib/fleet-quote.test.ts src/__tests__/lib/fleet-quote-sync.test.ts src/__tests__/components/deposit-hold-verify-permissions.test.ts src/__tests__/lib/stripe-connect-status.test.ts
```

The original foundation run passed **169 tests across 8 files**. After the V2 rollout correction, the four affected TRAX suites pass **84 tests**, including future V2 tenant enrollment, backend rejection for non-V2 tenants, V1 layout exclusion, no requests outside the gate and exact preservation of eight V1 files. Future enrollment is simulated through the server/client rollout policy in isolated tests; no additional real tenant has been enabled. These also cover authenticated scope, forged and cross-tenant IDs, revoked permissions, tenant switches, expired/forged conversations, stored prompt injection exclusion, legacy retrieval rejection, arbitrary navigation, attempted writes, financial abstention, body limits/timeouts and known database columns. Existing quote, deposit-permission and Connect-status tests are offline. The missing Testing Library DOM peer in this checkout was avoided using React's actual renderer for the new hook tests; dependencies were not installed or modified.

The browser test uses the actual Northwind V2 launcher, dialog, hook and backend handler with isolated anonymized fixtures. Only loopback and the intercepted offline API are allowed. It passes English guidance, server-verified navigation, Roman Urdu, mobile horizontal-overflow and browser-error checks. Switching to another tenant or a V1 layout removes the new assistant and sends no support requests. Desktop (1366×900) and mobile (390×844) screenshots are available: [desktop](../../artifacts/trax-phase1/desktop.png), [mobile](../../artifacts/trax-phase1/mobile.png). This is an offline integration check, not an authenticated production portal test.

The broader portal check was also attempted:

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false -p apps/portal/tsconfig.check.json
```

It **does not pass**. The checkout has errors outside this foundation, including React/Radix type conflicts, missing Testing Library exports, rental/vehicle type mismatches, `lib/reminder-generator.ts` importing missing `./templates`, and unrelated Deno imports. Existing ScrollArea ref conflicts also appear at the TRAX dialog/sidebar call sites. New test literal/import issues found during that run were corrected; the strict standalone backend check and focused tests pass. A clean full-portal type check is not claimed, and unrelated application/type infrastructure was not rewritten to obtain one.

## Local portal testing addition

The V2 development client now sends requests to the same-origin `POST /api/trax-support` route. It reuses `handleSupportRequest` and the extracted `createSupportReads` adapter from the edge function. The route returns 404 outside development, requires a bearer token and matching server configuration, bounds upstream reads, and retains the server-side V2, tenant and permission checks. Production still uses the separate edge function. No fallback to V1, fake authorization or business tools was added. Connection errors are visible above the input.

The running portal on port 4002 was probed without an account session: missing authorization returned **401**, and an inert non-session probe returned **503 `local_configuration_required`** before contacting Supabase. The checkout currently has no configured portal Supabase URL/server key. No successful signed-in local portal request is claimed. Configure the approved project's server environment and follow [the local testing guide](local-testing.md) to finish that verification; local authentication reads contact the configured Supabase project.

The new route integration suite passes **15 offline tests**. The affected hook suite passes **15 tests**, including local-versus-production endpoint selection; the backend handler and conversation suites pass **65 tests**. The automated fixture browser check also passes after the changes. `node tests/trax/browser.mjs --manual` now provides an explicitly labelled, isolated interactive fixture option without credentials; it is not the real signed-in portal. The local API route and this guide are included in knowledge staleness tracking.

## Deployment checks and unresolved decisions

- Confirm the actual target environment, deployed application release, JWT gateway configuration, database columns, RLS/grants, function overloads and native return access. Repository policy copies and offline mocks do not verify a deployed database.
- Review deployment of the V2 frontend and dedicated trax-support endpoint together, including regenerated policy copies whenever V2 tenant enrollment changes. The new client rejects live-looking legacy responses and never falls back to V1 chat. Global legacy grants/indexer changes are not included in this rollout; the SQL proposal remains outside migrations and requires separate approval.
- Approve separate finance entitlements for rental finances and account funds. All Phase 1 finance capabilities are denied, including for admins.
- Verify Stripe/Square selection, historical UK/UAE platform, sandbox/live and connected-account provenance, and provision restricted read credentials through server secret management before any future finance adapter. No credentials should be pasted into chat or documentation.
- Decide conversation/log retention, provider data processing, and whether later model-assisted routing is desired. Phase 1 uses deterministic prepared guidance and browser memory while those policies are unresolved.

No Phase 2 live diagnostics, Phase 3 Stripe/reconciliation, business writes, charts, exports, tickets or voice were implemented. No live migrations, deployment, production record checks, provider calls, payment operations or opt-in money-moving integration tests were run. Calendars, rental pages, customer messaging and unrelated application sections were not redesigned. V2's existing Ask AI navigation control was connected; V1 navigation remains unchanged.
