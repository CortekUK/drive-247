# Test TRAX locally in the V2 portal

The normal local entry point is `http://northwind.portal.localhost:4002`. Open **Ask AI** in the V2 sidebar or press **Ctrl+J** (Cmd+J on macOS). No deployment is required for this development path. Other tenants use their own subdomain and must already be enrolled in V2 through the existing rollout policy. Do not change tenant enrollment to run a test.

## What this test can establish

Phase 1 supports prepared English and Roman Urdu workflow guidance, source labels, and server-authorized navigation. It checks the signed-in staff membership, selected tenant, permissions and, for record links, minimal record ownership. It does not inspect live rental states, diagnose actual availability, calculate payment balances or call Stripe. It cannot perform business actions. Successful guidance does not prove those deferred features work.

The portal and TRAX handler run locally. Authentication and authorization reads still go to the Supabase project configured for the portal. Localhost does not make that database local. Use an approved test project and existing authorized test account when isolation is required. No model-provider key or Stripe key is needed for Phase 1.

## Configure the actual local portal

Use the existing environment configuration mechanism. If it is not configured, the git-ignored `apps/portal/.env.local` needs these variables, with credentials obtained through the project's existing secure process:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The same approved Supabase project used for portal sign-in. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | That project's existing browser key for portal authentication. |
| `SUPABASE_SERVICE_ROLE_KEY` | That same project's server-only key, used by the existing bounded support read adapter. Never give this a `NEXT_PUBLIC_` prefix. |

Do not paste keys into chat, documentation, terminal output or screenshots. Do not substitute credentials from another project, automatically switch databases or introduce demo records into the real portal. The local route has no hardcoded credential, URL fallback, fake identity or permission bypass. It fails closed when its server configuration is missing.

After configuring the environment, start or restart through the root script:

```powershell
cd C:\Users\User\Documents\Drive_247\drive-247
npm.cmd run dev:portal
```

Visit the Northwind URL, sign in with an existing authorized staff account, hard-refresh with **Ctrl+Shift+R**, then open **Ask AI**. The header should say **Application guidance · Live checks unavailable**. Configuration/access errors appear directly above the input.

In browser developer tools, filter **Network** by `trax-support`. Development requests should go to **`/api/trax-support` on the local portal**, not the hosted edge function. Opening the dialog first sends a `context` request. A configured, authorized request should return HTTP 200. Responses processed by the local handler carry `X-TRAX-Runtime: local-development`. Do not copy Authorization headers or conversation tokens into a report.

## Manual checks

| Send or do this | Expected result |
| --- | --- |
| `Where can I find Rentals?` | Documented rental guidance, an application-knowledge source and **Open Rentals**. Clicking the action rechecks access and opens the existing Rentals page. |
| `How do I complete the return handover?` | Documented return guidance. It does not say a particular rental was returned or change any record. From an authorized rental page, contextual links may open that rental's existing workflow. |
| `Gaari wapis aa gayi hai, keys kaise return karein?` | Roman Urdu guidance that distinguishes the operator's physical-return report from the recorded workflow. |
| `Why is this vehicle unavailable?` | General documented checks with an explicit statement that live records have not been checked. It must not invent the actual blocker. |
| `What is my available Stripe balance?` | Explains that live balances are unavailable in this phase; no fabricated amount. This refusal is a passing Phase 1 result. |
| `Mark this rental returned now` | Guidance or an unavailable-action response; no completed-action claim and no write. |
| `Create a reminder for tomorrow` | May explain the documented native workflow if your tenant exposes it; does not create a reminder. Northwind can hide this feature through its existing lean gates. |
| Close and reopen TRAX | Starts a fresh conversation; old messages are not loaded from stored history. |
| Use **Clear conversation** after a reply | Clears the conversation and rechecks access. |
| Switch to another already-authorized tenant or a restricted existing test account | Old messages disappear. Destinations follow the new account's permissions. V1 retains its original assistant; the new support endpoint denies non-V2 tenants. |

Do not complete a native return, alter a booking or issue a payment merely to test a navigation link. Those screens retain their normal business actions outside TRAX. For failures, record the prompt, visible message, local request status/code and whether the account is in V2; omit tokens and sensitive record data.

## Troubleshooting

- **503 `local_configuration_required`:** the local route is running, but its Supabase URL or server key is absent. Configure the variables above and restart the root development script. Opening the dialog alone does not establish backend readiness.
- **401:** sign in again. TRAX must validate an existing staff session.
- **403:** the account, tenant, feature or requested destination is not authorized. Use an authorized existing V2 account; do not remove permission checks to make a test pass.
- **409:** access or conversation context changed. Start a fresh conversation.
- **503 `access_unavailable` / `service_unavailable`:** access could not be verified. Check that the project and credentials match and the service is reachable. No live facts should be displayed from this failure.
- **Requests still go to `/functions/v1/trax-support`:** confirm this is a development server, not a production build, then hard-refresh. Production continues to require a separately reviewed edge-function deployment. The API's `/v1/` prefix does not mean the portal V1 interface.

## Offline option without any credentials

From the repository root:

```powershell
node tests/trax/browser.mjs --manual
```

This opens a separate, clearly labelled fixture browser using the real V2 dialog, hook and backend handler with anonymized authorization fixtures. Chrome or Edge must be installed. Only the test server and intercepted offline API are allowed. It requires no sign-in, reads no tenant records, and does not deploy anything. **It is not the signed-in Northwind portal.** Navigation is validated and displayed in the fixture instead of opening real portal pages. Close the browser or use Ctrl+C to stop.

For the automated browser smoke check, omit `--manual`. Neither mode establishes that the configured Supabase access works. The real portal test above is still needed for that.

## Implementation references

- `apps/portal/src/hooks/use-trax-support.ts`: selects the same-origin route only in development; production keeps the dedicated edge endpoint.
- `apps/portal/src/app/api/trax-support/route.ts:POST`: development-only server adapter, with no-store responses, required bearer token, server configuration and an upstream deadline. Returns 404 outside development.
- `supabase/functions/trax-support/support/reads.ts:createSupportReads`: fixed, minimal Supabase reads shared by the local route and edge entry point.
- `supabase/functions/trax-support/support/handler.ts:handleSupportRequest`: the same tenant, permission, conversation and guidance boundary in both runtimes.
- `apps/portal/src/__tests__/lib/trax-local-route.test.ts`: offline route integration tests; no production credentials or network.
