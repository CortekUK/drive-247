# V2 TRAX: issues, handoff and retention

Current human-support messaging, platform inbox and email delivery preparation are documented in [in-app-support.md](in-app-support.md). The single staff-note UI described in this earlier milestone is superseded by persistent two-way messages. No live deployment is implied.

Review date: 2026-09-15. Knowledge candidate 0.3.1. Source base commit and working-tree hashes: `knowledge-manifest.json`. Application release and production deployment parity remain unverified. This report supersedes the earlier operational milestone where they differ; those reports retain their historical test evidence.

## Implemented package

TRAX opens from the V2 top bar **Trax** button (and Ctrl+J) in the docked Trax panel and the `/trax` page (`TraxSupportThread` inside `TraxSupportProvider`). Both headers switch one workspace between the conversation and the conversation history through `SupportWorkspace`, `useTraxSupport`, the development route and the dedicated `trax-support` edge endpoint. Human support is not a TRAX view: Open Support navigates to the portal's Support section (`/support`, `PortalSupport`), which holds the tickets, their conversations and the retention controls. Both ends enforce the existing V2 chrome rollout; Northwind is a canary, not a hardcoded authorization exception. No V1 chat, calendar, rental/payment operation or unrelated page is changed by this package.

`model.ts:configuredModel` now calls OpenAI Responses with a server-configured model, strict function schemas, structured answers and `store:false`. `orchestrator.ts:modelConversation` accepts one tool call at a time, at most seven tools/eight model turns, with a 65-second request deadline, 18-second provider calls and 8-second database fetch deadlines. Provider errors become an honest fallback. Private provider reasoning is never copied to chat history, tickets or logs. The function-call protocol follows the [OpenAI function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling).

Shared knowledge remains a small compiled catalog with exact section selection, not a repository scan or tenant embedding collection. New reviewed sections cover V2 rental intake, Listing (no Publish button), customer creation entry, Bonzah setup and general payment-method guidance. The catalog has 39 features: six verified at stated narrow scopes, six partial, 26 requiring confirmation, one unsupported. Complete application knowledge is not claimed. Code/document changes rebuild only the review candidate; publishing still requires matching the deployed release.

## Live facts and limits

`fleet-tools.ts` adds these tools to the existing exact-resolution, rental-context and vehicle-diagnostic tools:

| Tool | Input | Output and freshness | Permission / maximum query scope |
|---|---|---|---|
| `get_account_counts` | `kinds: ('vehicles'|'customers'|'rentals')[]`, 1–3 values | Current exact head counts for complete tables, each with verified/restricted/error and total or null; observation time | Each corresponding view grant; explicit authenticated tenant predicate; no full records loaded |
| `list_account_bookings` | `view: 'active'|'upcoming'|'out_now'`, nullable offset | Exact booking total plus at most 50 rows, next offset, tenant-local date/timezone; unique vehicles only if the full set and relationships are verified | Rentals view; vehicle IDs additionally require vehicle permission and individual tenant validation; no whole-fleet total inferred from a page |
| `find_available_vehicles` | Nullable start/end dates, customer timezone, pickup-location UUID, offset | At most five freshly diagnosed vehicles; blocked / no blocker in evaluated rules / unknown; exact fleet size but no fabricated whole-fleet available total | Vehicle view plus each reused diagnostic's permissions; same V2 predicates, no subtraction of rentals from cars |
| `select_support_issue` | Enumerated topic and optional previously resolved record kind/UUID | Current issue and backend score; no caller-provided tenant, user or score | Same authenticated conversation; record must resolve first; 12 issues maximum |
| `request_support_handoff` | Enumerated reason | Validated policy transition and button availability; **does not create a ticket** | Backend validates the reason against recorded evidence or explicit user intent |

All use strict schemas with unknown keys rejected. Infrastructure failure and missing permissions never become zero. Observation timestamps describe reads, not physical events. Recorded `Active`/`Started` is the shared V2 out-on-hire rule, including overdue open rentals; it is different from date-derived display status. Upcoming lists include Pending/Upcoming/Confirmed records starting on or after the tenant-local date, with pending explicitly not treated as approval. “Free now” is not proof of bookability: the latter needs the actual requested dates and customer timezone. Changes during pagination may make a page partial; partial unique-vehicle totals are null.

Existing unavailable-car flow is preserved: resolve the page/exact car → obtain missing operation/dates/timezone → run shared visibility, dates/duration, location, occupancy, block and turnaround checks → return canonical blockers and authorized rental references. An overdue Active/Started rental without receiving completion can offer the existing return workflow to an editor. A recorded receiving/state conflict offers review rather than another return. Physical return remains an operator report. The assistant never completes return, and Check Again refreshes the current issue after native work.

**Payment extension:** [Read-only finance](read-only-finance.md) now implements bounded internal payment checks, exact mapped Stripe reads and exclusive account funds. These remain disabled until `TRAX_FINANCE_READS` is enabled; access follows Supabase staff roles/permissions, and Stripe keys are read by name inside Supabase. Unsupported currencies/mappings and complete rental money totals are not guessed. Staff with payment access can investigate before handoff; others receive the existing honest limitation. No charge, capture, refund, release, transfer, payout or repair tool exists.

## Deterministic issue policy

`issues.ts` stores issue ID/topic/record, redacted summary, independent score/state, checks, unknowns, record references, event history, a relevant excerpt and optional ticket ID. The score is support policy, not model confidence.

| Event | Default transition |
|---|---|
| Missing material input | Floor 25; clarification is not a failure |
| Missing reviewed guidance / failed required tool | Floor 50 |
| Verified receiving/state conflict | Floor 75 |
| No permitted reliable diagnostic / unsupported finance / explicit human request / required model unavailable | 100 |
| New verified progress | Reduce by 25, minimum zero |
| User confirms resolution | Zero and resolved state |

Repeated events/checks are deduplicated by their keys and results; sending messages alone never increments a score. The model cannot assign scores. `TRAX_ESCALATION_POLICY` can override validated backend thresholds; immediate human handoff and resolution retain their invariants. The UI offers **New issue**, selection, **This is resolved**, and **Request human support**. Explicit human requests skip more model troubleshooting and preserve the current issue's checks. Marking an issue resolved never closes a submitted ticket.

Bounds: 12 issues/conversation, 24 checks/issue, eight findings and eight limitations/check, 32 transition events, 12 record references/unknowns, eight redacted issue turns. These are useful recent context, not a complete audit transcript. Stored JSON is limited to 100 KB; ticket handoffs to 60 KB. The unconfigured session fallback is bounded separately (98 KB plaintext context; 132,000-character token; 145 KB overall request). Non-context request fields remain limited to 16 KiB and messages to 4,000 characters. Capacity errors do not authorize silently dropping unrelated stored records.

## Actual ticket workflow

No established support-ticket system was found. The review-candidate migration `supabase/migrations/20260915190000_trax_v2_support.sql` creates only four TRAX tables: `trax_support_agents`, `trax_support_retention_policy`, `trax_support_conversations`, `trax_support_tickets`.

`support-store.ts:createTicketStore` is the sole persistent adapter. `handler.ts` exposes fixed **UI request types**, separate from the model's tool registry: resume/select/new/resolve/escalate issue; submit/list/detail/update tickets; retention policy/preview/hold. Tenant/user/scope always come from verified server context. Conversation revisions prevent stale overwrite. Stored history is loaded only for its owner and current scope; permission or knowledge-scope changes fail closed rather than reusing old evidence. The current release does not migrate older conversation scopes automatically.

At 100, **Contact Support** states that it shares a relevant redacted excerpt, checks and authorized references. Clicking rechecks membership, issue ownership, score, related entities and queue configuration. The SQL transaction independently checks membership and related-record grants. A unique issue ID and conflict handling return one persisted ticket across retries. Failure leaves the conversation available and shows no ticket number. The user sees a real TRX reference only after successful storage.

The handoff distinguishes user reports from observed checks and their timestamps; it includes unknowns, escalation reasons, conversation/issue IDs, record references and recent redacted excerpts. No credentials, contact details, identity documents, raw processor identifiers or private model reasoning are intentionally retained. Pattern redaction is defense in depth, not a claim that arbitrary text can always be perfectly anonymized. Restricted native fields are never loaded in the first place.

**My support requests** is owner/tenant/current-scope restricted. **Support queue**, ticket detail and status updates require an explicit active `trax_support_agents` grant, independently of being a tenant admin or super admin. Grants are not seeded. Assigned support agents may handle cross-tenant tickets; this is an explicit platform-support privilege. The note field is labelled visible to the requester. Open / In progress / Closed are support-ticket states, not rental states. There is no email, Slack, external helpdesk or immediate-response promise.

RLS is enabled with no browser policies; browser roles cannot read these tables or invoke their RPCs. Only the server service role receives access. The model cannot invoke storage/cleanup RPCs, arbitrary SQL, shell, HTTP or a generic database client. Request logs contain request IDs/status/counters/duration, not prompts, tokens, IDs of operational records or ticket content. Review reverse proxies/APM settings before deployment so they do not log request bodies.

## Approved initial retention settings, not production cleanup approval

| Stored material | Default policy |
|---|---|
| Ordinary conversations, diagnostics and issue scores | 90 days after last conversation activity; automatic context polling does not extend retention |
| Open/in-progress tickets | Keep; flag after 90 inactive days by default for support review |
| Closed tickets | 365 days after latest closure; reopening clears closure time until next closure |
| Copied redacted handoff | Ticket policy; deleting chat sets its ticket FK to null without deleting the handoff |
| Approved retention exceptions | Explicit holds exempt the selected conversation or ticket |

Administrators with an explicit `can_manage_policy` support grant can change periods (1–3,650 days), inspect a dry-run preview and apply/remove holds. Ordinary tenant administrators receive no such permission automatically. The V2 **Retention** screen exposes those controls. Ticket holds appear in authorized ticket details; conversation holds use the handoff's conversation reference. Record the approval reason in the organization's retention decision record (and the visible support note for a ticket); automatic exception expiry and a separate immutable retention audit log are not implemented.

If pg_cron is installed, the reviewed migration registers a daily **dry-run-only** job at `17 3 * * *`, calling `trax_support_cleanup(true)`. Check the scheduler timezone in the target environment. Without pg_cron, register that same dry-run call with an approved server scheduler; no schedule is claimed until verified. Dry run reports eligible conversation/closed-ticket counts and inactive open-ticket review count. It deletes nothing.

`trax_support_cleanup(false)` refuses to run unless both `cleanup_enabled` and `cleanup_approved_at` are set administratively. The UI cannot set those fields. The migration defaults to disabled and does not schedule a destructive call. **No production approval, migration, grant or destructive activation has been performed.** A separately reviewed activation must record approval, validate a dry run, check holds/backups, then deliberately change the scheduled call. Disabling storage or cleanup preserves existing records; do not roll back by deleting support history.

Cleanup has fixed statements against TRAX conversations and closed tickets only. It never deletes rentals, vehicles, customers, payments, legacy chat, credentials or application knowledge. Open tickets survive; expired chats can disappear independently because only relevant handoff excerpts were copied.

### Backups and external providers

Application deletion does not prove deletion from Supabase backups/PITR, infrastructure logs or approved exports. The target project's backup retention, restore workflow, log retention and legal exceptions were not inspected or changed. Deployment owners must document those periods separately. Following a restore, keep destructive cleanup disabled, reinstate approved exceptions and perform a new dry run before activation. Do not claim the 90/365-day application policy covers backup media.

Responses use `store:false` and no OpenAI Conversations, files, vector stores or external helpdesk. This does **not** establish Zero Data Retention: abuse-monitoring retention and model/prompt-cache exceptions are separate provider controls. Verify the actual organization/project agreement before production. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). No project-specific provider-retention or backup policy has been certified here.

## Local review and deployment sequence

1. Run the offline tests and browser harness below. They require no keys and touch no live records.
2. Review the migration against a dedicated local/staging database, including existing `app_users`, tenant and manager-permission conventions. Do not apply it blindly to the currently configured live Supabase project.
3. Obtain migration/storage rollout approval, apply only to the approved environment, and assign actual support staff explicitly. Queue delivery must be staffed; the capability remains disabled if no active agent exists. Do not grant all tenant admins cross-tenant support access.
4. Enable server-only `TRAX_SUPPORT_STORAGE=enabled` for that approved environment. Keep model credentials in the ignored portal server environment / edge secret store, never `NEXT_PUBLIC_*`. Production uses the separately deployed edge endpoint; the local route is development-only.
5. Fund/enable the approved OpenAI project and perform signed-in V2 tests on the actual environment. An earlier model attempt returned HTTP 429 insufficient quota; the latest connectivity probe timed out without a response. See completion-status.md; current provider connectivity must be verified.
6. Verify scheduled dry runs and retention holds. Destructive production cleanup remains a separate explicit approval step.

## Reproducible verification

From the repository root:

```powershell
node scripts/trax-knowledge.mjs --check
node node_modules/typescript/bin/tsc -p supabase/functions/trax-support/tsconfig.offline.json --pretty false
node tests/trax/browser.mjs --support
node tests/trax/browser.mjs --operational
node tests/trax/browser.mjs
```

For an interactive fixture browser: `node tests/trax/browser.mjs --support --manual`. Ask about a missing payment, observe the explicit limitation, then click Communicate with Support; the fixture leaves TRAX for the Support section, where the composer, My Tickets and Retention are. Reopen TRAX from Ask AI to see the conversation and its history unchanged. This fixture shows a labelled fixture reference and makes no live-provider calls. It is not the signed-in portal or durable production storage.

`tests/trax/support-storage.mjs` executes the actual migration in isolated PostgreSQL/WASM (PGlite). Install its test-only dependency outside the repo, then run:

```powershell
$traxSqlTestRoot = Join-Path $env:TEMP 'drive247-trax-sql-tests'
npm.cmd install --prefix $traxSqlTestRoot --no-audit --no-fund @electric-sql/pglite
node tests/trax/support-storage.mjs
```

`TRAX_PGLITE_PATH` can override the PGlite module path. No application dependency was added. This is actual PostgreSQL execution of the candidate SQL, but it does not verify hosted Supabase, deployed policy compatibility or pg_cron scheduling. The fixture-only destructive test enables cleanup exclusively inside its disposable in-memory database.

Portal test files: `trax-escalation.test.ts`, `trax-operational.test.ts`, `trax-support.test.ts`, `trax-knowledge.test.ts`, `trax-local-route.test.ts`, `trax-session.test.ts` and `use-trax-support.test.tsx`. They cover Tenant 1 with two cars / Tenant 2 with six, exact counts beyond pagination, failed/null totals, malformed cross-tenant relations, scope changes, restricted grants, partial results, shared availability rules, deterministic scores, new issues, explicit handoff, duplicate submissions, retry, provider failures, secret redaction and attempted writes. SQL tests independently cover RLS/RPC denial, idempotency, queue permissions, related-record validation, revisions, retention, reopening, holds and protection of business tables.

Verification results: 217 targeted portal tests (48 escalation, 66 operational, 61 support, 17 hook, 15 local-route, four session, six knowledge); 24 isolated PostgreSQL migration/retention tests; all three offline browser modes passed. The strict backend TypeScript check passes. Focused UI compilation reports the same seven diagnostics as the in-memory original HEAD comparison, with no added diagnostics; a clean whole-portal build is not claimed. Evidence: `artifacts/trax-support/vitest-results.json`, `vitest-escalation.json` and `typecheck-comparison.json`.

Desktop/mobile screenshots were visually reviewed for clipping, spacing, readable handoff states and accessible actions. They are fixture screenshots: [escalation](../../artifacts/trax-support/escalation-desktop.png), [ticket detail](../../artifacts/trax-support/ticket-desktop.png), [support queue](../../artifacts/trax-support/support-queue.png), [retention](../../artifacts/trax-support/retention.png), [mobile](../../artifacts/trax-support/mobile.png). Browser storage is a test double; the separate SQL tests prove actual PostgreSQL persistence and retention logic. No hosted deployment, production record mutation or destructive production cleanup occurred.

No real-model accuracy percentage, reconciliation accuracy, response latency or cost-per-resolved-query has been measured. Scripted models prove boundaries and wiring, not language understanding. Actual English/Roman Urdu model evaluation and signed-in end-to-end tests remain outstanding. Partial/refunded/multi-currency finance scenarios now have isolated tests in the read-only finance package; production finance remains disabled.

The verification counts above describe the earlier support milestone. See read-only-finance.md and artifacts/trax-support/final-results.json for the subsequent combined regression run; fixture screenshots are under artifacts/trax-finance.
