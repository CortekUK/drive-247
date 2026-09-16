# In-app human support (V2)

Repository implementation verified locally on 2026-09-15. Review candidate, not a deployment claim. New functions/migrations must be activated in an approved environment. No live email delivery or hosted account test is claimed.

## Operator workflow

Open TRAX and choose **Support** in its header — My Tickets in the standalone dialog — to return to a saved conversation without asking the AI again. Support opens inside the TRAX panel; it never routes to another page. New request opens a subject/message composer. For an escalated issue, Communicate with Support opens the same composer with the issue summary available for editing. Opening or cancelling creates no ticket. The first non-empty Send commits the ticket, initial message, copied troubleshooting handoff and email job. A successful response shows the actual reference; retrying does not create a duplicate. An issue with a ticket opens its existing thread.

Reply in the thread to continue. You and Drive247 Support identify the human participants; TRAX never posts a human reply. Support staff can set Open, In progress or Resolved while sending an update. Resolved maps to the existing `closed` database state. A tenant reply reopens that same ticket and clears its closure timestamp. AI suggestions and issue-resolution controls do not close a human ticket. New unrelated issues use New request.

The model is not involved in the support tickets view, reads, replies, unread counts or direct ticket creation. The escalation composer uses the existing authenticated issue handler only to copy its authorized context. During an AI outage the independent ticket composer remains available. Credentials, payment/card identifiers and obvious personal contact data are redacted before persistence. Human messages do not authorize rental, payment, insurance or other business writes.

## Platform support workspace

The actual platform app adds `/admin/support`, reached through Super Admin → Management → Support, immediately after Contact Requests. The navigation item is visible to platform super admins even when support storage is unconfigured or unreachable. Menu visibility is not ticket authorization. The page checks access before mounting the inbox, showing a specific local setup message, an access-required message, or an unavailable state with Check again. An unread badge appears only after a successful authorized count; failures never become a fabricated zero. `app_users.is_super_admin = true`, active membership, **and** an active explicit `trax_support_agents` grant are all required to read tickets or messages. Tenant admin roles, the email recipient, names/display labels and client `admin` flags confer no cross-tenant access. The older queue endpoints use this same platform restriction after the messaging migration.

The inbox has search, existing-state filters, pagination, tenant/requester identity, last activity and unread markers. Select a ticket to see messages, reply and change status. Historical diagnostics are in an expandable section. The handoff distinguishes user reports from timestamped observations. Current record permissions are rechecked for tenant access to this context; revoked diagnostic access hides the handoff without orphaning the owner's human conversation.

## Unread and updates

`trax_support_reads` stores a per-ticket, per-authenticated-viewer sequence. The count is distinct tickets with incoming messages newer than that viewer's read position. Five unread messages on one ticket contribute one. An admin reading does not change another admin's badge. Own replies do not create incoming unread messages. Opening a list or fetching a thread never marks it read. The client acknowledges only displayed message elements, using the returned sequence rather than the current server maximum; a newer concurrent message stays unread.

The support tables deliberately have no direct browser SELECT/RPC grants or realtime payload subscriptions. Both apps automatically reconcile via the authenticated API every five seconds while visible, and on focus, reconnect and visibility changes. No optimistic badge counter substitutes for persisted state. This is automatic polling, not WebSocket delivery. Requests time out and stop/reject late results when the account scope changes. A failed count is unknown, not a fabricated zero.

Messages are ordered by a per-ticket monotonic sequence, serialized under the ticket lock. Fetches return the latest 50 with older-message pagination; lists return 25 plus a next-page marker. Duplicate nonces cannot append twice. First-submission nonces survive refresh in session storage without storing message content there. Failed outgoing drafts remain in memory for retry; once a request is uncertain, Retry sends its original payload. Drafts are not promised to survive closing the page.

## Email alert and configuration

The existing approved `sendResendEmail` service is reused. No Gmail integration, mailto redirect or reply ingestion is added. `trax_support_email_jobs` is committed with the first tenant message and cascades only with ticket retention. Follow-ups update in-app unread state without adding new-ticket emails.

Server configuration:

| Setting | Purpose |
|---|---|
| `TRAX_SUPPORT_STORAGE=enabled` | Enable support storage after both migrations have been reviewed/applied in the chosen environment |
| `TRAX_SUPPORT_EMAILS=enabled` | Allow the deployed notification worker to deliver queued alerts |
| `TRAX_SUPPORT_NOTIFICATION_TO` | Requested destination defaults server-side to `ilyasghulam35@gmail.com`; use a test recipient in testing |
| `TRAX_SUPPORT_ADMIN_ORIGIN` | Actual platform admin origin; `/admin/support?ticket=<id>` is generated from it |
| `TRAX_SUPPORT_WORKER_SECRET` | Dedicated scheduler authorization, stored only in the server/Vault secret managers |
| `RESEND_API_KEY` | Existing transactional provider credential; not printed, shared with a model or sent to the client |

The development apps use `/api/trax-messaging` with their existing server Supabase configuration; production uses the separately deployed `trax-messaging` edge function. The local route returns 404 outside development. No project URL, tenant or staff grant is hardcoded for production enrollment.

For local Next apps, configure each app's ignored `.env.local` (`apps/portal/.env.local` and `apps/admin/.env.local`) with the same intended project's `NEXT_PUBLIC_SUPABASE_URL`, browser `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`, and the storage flag. Restart those dev servers after changing environment settings. Never prefix the service key with `NEXT_PUBLIC_`. Platform support assignments use the approved staff member's `app_users.id` in `trax_support_agents.staff_id`, not their email or Auth user id. No grants or private environment files were changed by this implementation.

Deployment preparation: apply `20260915190000_trax_v2_support.sql` then `20260915200000_trax_support_messaging.sql`; assign approved platform staff; deploy `trax-messaging`, updated `trax-support`, and `trax-support-notifications`; configure the settings above. Review `ops/trax-support-notification-schedule.sql` to schedule the worker every minute with pg_cron/pg_net and Vault-managed URL/secret. This script has not been executed here and contains no credentials. Provision the dedicated Vault entries privately before running it in an approved environment. This schedule does not enable retention deletion.

The worker leases at most five jobs per invocation. It freezes the rendered recipient/link/body before send, uses one stable provider idempotency key per ticket, records provider acceptance separately and retries failures with backoff (maximum eight attempts). An uncertain job older than 23 hours becomes `review`; it is not blindly resent beyond [Resend's documented 24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys). Simulated sends are failures for delivery accounting. Provider acceptance is not proof of inbox receipt. Administrator ticket details show pending, sending, failed and review states. Provider response text/credentials are not persisted in error messages. A provider failure never rolls back a ticket or its first message.

Alert template: `[Drive247 Support] New ticket #<reference> — <tenant>`, with tenant, requester display name, short subject, creation time, safe first-message preview and authenticated Open Support Ticket link. No diagnostic handoff or full transcript is emailed. Payment/identity-related previews are replaced with an instruction to inspect Support. Text is HTML escaped; links and lengthy identifiers in previews are removed. There is no authentication bypass in the email link.

## Permissions and storage contracts (developer reference)

`handleMessaging` accepts `action`, bounded action-specific `data`, optional tenant context hint and an admin-view flag. Server authentication derives user/staff identity; ordinary staff always use their membership tenant. The V2 rollout is rechecked with `authorize`. SQL rechecks active membership and the dedicated support grant in each transaction.

| Action | Input data | Output | Scope |
|---|---|---|---|
| count | none | unread distinct-ticket integer | Owner/current tenant or authorized platform queue |
| list | optional search ≤120, status, offset ≤10000 | 25 ticket summaries, nextOffset, unread | Same authorization, no cross-tenant owner results |
| create | nonce UUID, subject ≤240, body ≤4000 | Actual id/reference | Owner/current tenant; 10 new tickets/hour |
| detail | ticket id, optional before sequence | Ticket/handoff, up to 50 ordered messages, hasOlder/latestSeq | Revalidate ticket access and diagnostic context |
| send | ticket id, nonce UUID, body ≤4000 | Persisted message and sequence | Owner or authorized platform staff; 30 messages/minute |
| read | ticket id, displayed through sequence | Confirmed read position | Current viewer only; monotonic, cannot exceed server sequence |
| status | ticket id, nonce UUID, body, existing status | Confirmed status | Platform support only; status and human update atomic |

There are no arbitrary SQL/HTTP/model mutation tools. Private tables are service-only with RLS enabled and no browser grants. Missing/inaccessible tickets return the same unavailable access result. Messages are plain text, not executable instructions or trusted markup. Neither shared knowledge nor the AI receives ticket threads by default.

Retention remains 90 days after ordinary AI-chat activity, open human tickets retained, and closed tickets 365 days after their latest closure; reopening cancels deletion. Ticket messages, read positions and email jobs cascade with the retained ticket. Copied redacted handoffs survive ordinary AI-chat cleanup. Approved holds and configurable administrator policy remain. Destructive production cleanup is still disabled pending approval. Provider/backup retention remains separately governed as described in support-escalation.md.

## Verification and limitations

Navigation follow-up: the missing-menu report was reproduced with the running local admin endpoint returning HTTP 503 for absent server configuration. Support now remains discoverable for platform super admins; `AdminSupportWorkspace` withholds the inbox until access is verified. Six readiness-hook cases cover missing setup, recovery, outages, revoked access, ineligible viewers and late account responses. The browser regression also checks visible navigation during setup failure, successful retry, an unassigned super admin denied by the actual isolated SQL, and no platform Support link for ordinary staff. This does not configure credentials, apply hosted migrations or assign support access.

Run `node tests/trax/messaging-storage.mjs` for actual isolated PostgreSQL migrations, `node tests/trax/messaging-browser.mjs` for rendered tenant/admin flows using the real handler and isolated database, and the portal's `trax-messaging.test.ts` / `trax-escalation.test.ts` regressions. Existing TRAX browser modes and retention/finance regression suites remain part of handover checks. Fixtures are isolated from production imports.

Automated tests do not prove real Supabase Auth/RLS deployment parity, pg_cron/Vault installation, network reconnect behavior on a hosted environment, or delivery to the requested inbox. Those require approved staging deployment and two signed-in tenant accounts plus a granted platform support account. No such live deployment, database mutation, email, or business/financial action was performed during this change.

Local results: 299 targeted Vitest cases pass after updating the knowledge coverage assertion and rebuilding the artifact. The final focused rerun covers messaging and knowledge; the remaining cases passed in the broader regression run. Actual isolated SQL passes 34 messaging cases plus the existing 24 storage/retention cases. The prepared-guidance, operational, finance and escalation/retention browser modes pass; the additional messaging browser exercises the real handler and candidate SQL with tenant/admin interfaces. Backend strict compilation and the focused admin compilation pass. The portal still has its same seven pre-existing type errors in the shared button/React types, TRAX scroll ref, tenant context and auth store; no clean whole-portal build is claimed.

Review artifacts: [verification results](../../artifacts/trax-messaging/verification.json), [tenant composer](../../artifacts/trax-messaging/tenant-composer.png), [tenant conversation](../../artifacts/trax-messaging/tenant-conversation.png), [mobile conversation](../../artifacts/trax-messaging/tenant-mobile.png), [Support 2 badge](../../artifacts/trax-messaging/admin-unread-two.png), [admin conversation](../../artifacts/trax-messaging/admin-conversation.png), and [unsent email template](../../artifacts/trax-messaging/email-template.html). All screenshots and the email preview contain isolated test fixtures.

<!-- trax:human_support:en -->
In V2, open TRAX and choose **Support** in its header to find your human-support conversations inside the same panel. Choose New request, or Communicate with Support on an escalated issue, review the subject, write your message and press Send. Opening the composer alone submits nothing. After a confirmed submission, follow the ticket reference and reply in the same conversation. A reply to a resolved ticket reopens that issue. Use New request for a separate problem. Human support messaging does not depend on the AI model. If support storage is unavailable, the interface reports that limitation; it must not claim your message was sent. Do not include credentials, card details or identity documents. Messages do not change bookings or payments.
<!-- /trax -->
<!-- trax:human_support:ur-Latn -->
V2 mein TRAX kholen aur header mein **Support** chunein; tickets isi TRAX panel mein khulte hain. Naya masla bhejne ke liye New request ya escalated issue par Communicate with Support kholen. Subject review karein, apna message likhein aur Send dabayein. Sirf composer kholne se ticket nahi banta. Confirmed submission ke baad ticket reference aur isi conversation mein support ke replies milte hain. Resolved ticket par reply se wohi issue dobara open hota hai; alag maslay ke liye New request use karein. Human support chat AI model ke baghair kaam karti hai, lekin support storage configured hona zaroori hai. Credentials, card details ya identity documents share na karein. Chat messages bookings ya payments change nahi karte.
<!-- /trax -->
