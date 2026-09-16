# Test TRAX locally in the V2 portal

The normal local entry point is `http://northwind.portal.localhost:4002`. Click **Trax** in the V2 top bar or press **Ctrl+J** (Cmd+J on macOS). TRAX opens as a panel FLOATING over the page in the bottom-right corner: the page keeps its width, its scroll position and its own scrolling, and there is no backdrop over it. Its header carries the workspace: conversation history, a new conversation, Open Support, expand and close. Expand makes the floating panel larger over the same page — it is not a route — and Restore size puts it back. Below `md` the panel is a near-full-screen overlay instead. Open Support leaves TRAX for the portal's Support section (`/support`) — the same place the profile menu's Support item opens — and the AI conversation and any unsent draft are kept. No deployment is required for this development path. Other tenants use their own subdomain and must already be enrolled in V2 through the existing rollout policy. Do not change tenant enrollment to run a test.

## What this test can establish

TRAX has two explicit modes: prepared guidance when no approved model is configured, and model-backed support with read-only operational tools when the approved provider/key/policy is present. A rendered dialog or prepared answer does not verify model integration. The additional [read-only finance package](read-only-finance.md) remains disabled unless its explicit server grants and restricted credentials are configured. No mode provides business writes.

The portal and handler run locally, but authentication and read tools contact the configured Supabase project. Localhost does not make that database local. Use only an existing authorized V2 account; no production problem records are created for testing. Offline fixtures below remain separate.

## Configure the actual local portal

Use the existing environment configuration mechanism. If it is not configured, the git-ignored `apps/portal/.env.local` needs these variables, with credentials obtained through the project's existing secure process:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The same approved Supabase project used for portal sign-in. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | That project's existing browser key for portal authentication. |
| `SUPABASE_SERVICE_ROLE_KEY` | That same project's server-only key, used by the existing bounded support read adapter. Never give this a `NEXT_PUBLIC_` prefix. |

Do not paste keys into chat, documentation, terminal output or screenshots. Do not substitute credentials from another project, automatically switch databases or introduce demo records into the real portal. The local route has no hardcoded credential, URL fallback, fake identity or permission bypass. It fails closed when its server configuration is missing.

For the model-backed milestone, after explicit provider/data-policy approval, privately add the following **server-only** settings to the same ignored file:

```dotenv
OPENAI_API_KEY=<approved key entered privately>
TRAX_MODEL=gpt-4o
TRAX_MODEL_DATA_POLICY=minimal-operational-v1
```

The operational policy allows prompts, reviewed guidance and minimal authorized operational fields to OpenAI. It excludes customer contacts, notes, documents and credentials. Finance activation is separate and adds only the sanitized fields documented in read-only-finance.md. `TRAX_MODEL` is configurable; use a model available to the approved project that supports Responses function calling and structured output. Existing Supabase keys cannot substitute for an OpenAI key. The user's local model/key/policy setup was authorized and completed, but an earlier provider attempt returned HTTP 429 insufficient quota and the latest connectivity check timed out before any HTTP response. Verify current provider connectivity and configuration; an HTTP 200 prepared fallback is not a passing AI test.

After configuring the environment, start or restart through the root script:

```powershell
cd C:\Users\User\Documents\Drive_247\drive-247
npm.cmd run dev:portal
```

Visit the Northwind URL, sign in with an existing authorized staff account, hard-refresh with **Ctrl+Shift+R**, then click **Trax** in the top bar. The header says **AI support · Read-only operational checks** when model/key/policy are configured, or **Prepared guidance · Model not configured** otherwise. The configured header is a capability report, not proof of a successful provider call. Configuration/access errors appear directly above the input.

In browser developer tools, filter **Network** by `trax-support`. Development requests should go to **`/api/trax-support` on the local portal**, not the hosted edge function. Opening the dialog first sends a `context` request. A configured, authorized request should return HTTP 200. Responses processed by the local handler carry `X-TRAX-Runtime: local-development`. Do not copy Authorization headers or conversation tokens into a report.

## Signed-in manual checks, one at a time

1. Open the existing Northwind V2 local portal, sign in normally, then click Trax in the top bar. In Network, verify the `context` response is HTTP 200, with `capabilities.modelReady=true` and `finance=false` for model mode. Do not copy session headers or encrypted conversation tokens.
2. Ask **Where can I find Rentals?** Expect an AI answer grounded in the Rentals section and a server-verified Open Rentals action. Verify `provenance.engine=model`; `prepared_fallback` means the model path did not succeed. Click Open Rentals to verify navigation only.
3. Open an existing authorized vehicle record. Reopen Trax and explain the actual problem: missing from the **V2 website**, unavailable for **specific dates**, or **checkout rejection**. TRAX should use the page's vehicle after server validation. A vague report should cause a material clarification, not an invented window.
4. For date availability, provide the customer's actual pickup/return dates, browser timezone and selected pickup location if any. Expected answer: current canonical checks, record references, observation time and honest limits. A restricted account should see a generic rental/block blocker without private IDs or receiving details.
5. Ask **Which rental is blocking it?** and **Where do I complete the return?** Expect new evidence checks for current facts and permitted existing navigation. If receiving is already recorded while status is open, it should report the conflict and offer review, not repeat-return guidance.
6. Click **Check Again**. The backend should rerun the same diagnostic on fresh reads. Do not complete a real return just for testing; if staff independently complete a legitimate return through the existing workflow, recheck afterwards. Other bookings, blocks or buffers may remain. A negative website check is not a checkout guarantee.
7. Try Roman Urdu with the same context, for example **Gaari aur chabi wapis aa gayi, customer in dates par book nahi kar pa raha. Kaunsa rental rok raha hai?** Evaluate actual comprehension with the approved model; scripted tests do not establish language quality.
8. Ask **What is my available Stripe balance?** and **Mark this rental returned now**. Expect no amount and no mutation. An operational explanation/navigation action does not mean TRAX changed a record.
9. Close/reopen or clear the conversation, switch between existing authorized tenants/accounts, and verify old context disappears. Never change permissions or enroll a tenant just to test. V1 retains its original assistant.
10. Record only the local request ID, HTTP status, model/tool counts from the sanitized local server log, provenance engine, observation time and a redacted outcome. No Authorization header, conversation token, customer identity or key belongs in screenshots/log exports.

No suitable real availability issue is required for the real integration check: a legitimate vehicle's fresh read path can be verified separately, while the incomplete-return scenario stays fixture-tested. Record those two results separately. An HTTP 200 fallback is not a passing model integration test.

## Troubleshooting

- **503 `local_configuration_required`:** the local route is running, but its Supabase URL or server key is absent. Configure the variables above and restart the root development script. Opening the dialog alone does not establish backend readiness.
- **Prepared fallback / model not configured:** verify the three provider settings were added privately after approval and restart. A failed provider call also returns explicitly labelled fallback; no balance or diagnostic should be invented.
- **401:** sign in again. TRAX must validate an existing staff session.
- **403:** the account, tenant, feature or requested destination is not authorized. Use an authorized existing V2 account; do not remove permission checks to make a test pass.
- **409:** access or conversation context changed. Start a fresh conversation.
- **503 `access_unavailable` / `service_unavailable`:** access could not be verified. Check that the project and credentials match and the service is reachable. No live facts should be displayed from this failure.
- **Requests still go to `/functions/v1/trax-support`:** confirm this is a development server, not a production build, then hard-refresh. Production continues to require a separately reviewed edge-function deployment. The API's `/v1/` prefix does not mean the portal V1 interface.

## Offline option without any credentials

For the new support workflow, run `node tests/trax/browser.mjs --support --manual`. It uses the real V2 UI/hook/handler with isolated storage fixtures. Ask about a missing payment, see the limitation and the Communicate with Support button, follow it into the Support section, submit there, then inspect My Tickets and Retention and reopen TRAX to confirm the conversation is still there. References are explicitly fixture-labelled and disappear when this harness stops. Omit `--manual` for automated browser checks. Actual SQL persistence/retention tests and the approved-environment activation sequence are in [support-escalation.md](support-escalation.md).

In the signed-in portal, durable support requires the reviewed migration and actual assigned support staff before enabling server-only `TRAX_SUPPORT_STORAGE=enabled`. Do not enable it against the current Supabase project without approved migration/storage rollout. The default UI honestly disables submission while storage/delivery are unconfigured. Production destructive cleanup requires separate approval even after storage is enabled.

From the repository root:

```powershell
node tests/trax/browser.mjs --manual
```

This opens a separate, clearly labelled fixture browser using the real V2 dialog, hook and backend handler with anonymized authorization fixtures. Chrome or Edge must be installed. Only the test server and intercepted offline API are allowed. It requires no sign-in, reads no tenant records, and does not deploy anything. **It is not the signed-in Northwind portal.** Navigation is validated and displayed in the fixture instead of opening real portal pages. Close the browser or use Ctrl+C to stop.

For the automated guidance browser smoke check, omit `--manual`. Use `node tests/trax/browser.mjs --operational` for scripted-model operational fixtures, including the fresh recheck with a remaining block. Those fixtures never call a model provider or live database. Neither mode establishes that the configured Supabase access works. The real portal test above is still needed for that.

For the floating panel itself, run `node tests/trax/panel-browser.mjs` (add `--manual` to drive it by hand). It mounts the real panel and providers over a stand-in dashboard and measures the page while Trax opens, expands, restores and closes: the content column keeps its width and position, nothing overflows horizontally, no backdrop or scroll lock appears over the page, the panel keeps a readable corner size, and the conversation and an unsent draft survive closing. Screenshots are in `artifacts/trax-panel`.

## Implementation references

- `apps/portal/src/hooks/use-trax-support.ts`: selects the same-origin route only in development; production keeps the dedicated edge endpoint.
- `apps/portal/src/app/api/trax-support/route.ts:POST`: development-only server adapter, with no-store responses, required bearer token, server configuration and an upstream deadline. Returns 404 outside development.
- `supabase/functions/trax-support/support/reads.ts:createSupportReads`: fixed, minimal Supabase reads shared by the local route and edge entry point.
- `supabase/functions/trax-support/support/handler.ts:handleSupportRequest`: the same tenant, permission, conversation and guidance boundary in both runtimes.
- `apps/portal/src/__tests__/lib/trax-local-route.test.ts`: offline route integration tests; no production credentials or network.

The current requirement-by-requirement handover and most recent provider check are in [completion-status.md](completion-status.md). To inspect the read-only finance UI offline, run `node tests/trax/browser.mjs --finance --manual`; these fixtures do not enable real finance access.

## Two-way human support

Start with `node tests/trax/messaging-browser.mjs` from the repository root. It exercises the actual shared inbox/admin sidebar and backend against isolated PostgreSQL with two fixture tenants and one platform support identity; no live email is sent. Screenshots are in `artifacts/trax-messaging`. For configured local/staging apps, use the migration, grant, worker and scheduler checklist in [in-app-support.md](in-app-support.md). Support tickets stay independent of OpenAI.
