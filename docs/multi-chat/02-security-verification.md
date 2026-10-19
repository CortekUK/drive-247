# Multi Chat §1: security fixes, verification

Date: 2026-10-19. Applied to production (`hviqoaokxvlancmftwuo`).

## What changed

| Area | Change | Where |
|---|---|---|
| Twilio secrets | Auth Token and API key secret moved to Supabase Vault. `tenants.twilio_auth_token` / `twilio_api_key_secret` emptied and now held NULL by `CHECK tenants_twilio_secrets_not_plaintext`. Plaintext only via `twilio_get_secrets()`, executable by `service_role` alone. | migrations `20261019160100`, `20261019160200`; `_shared/twilio-secrets.ts` |
| Chat tables | RLS **on** for `chat_channels`, `chat_channel_messages`, `chat_channel_participants`. `anon` has no grants. Staff can access their own tenant only, or every tenant if super admin. Customers can access their own channel only, can send only as themselves and only in-app, and can update only `is_read` / `read_at`. | migration `20261019160000` |
| Voicemails | `voicemail_recordings` lost its `FOR ALL USING (true)` policy, and `anon` has no grants. | `20261019160000` |
| Storage | The `voicemails` bucket is now private, and staff can read only their own tenant's folder. Dropped `"Enable read access for all users"` (`SELECT USING (true)` on **every** object in **every** bucket). Greetings moved to a new public `voice-greetings` bucket that staff can write only in their own tenant folder. | `20261019160000`; `twilio-calling.tsx` |
| Internal tools | `send-tenant-sms` accepts the service role only. `diag-twilio-a2p`, `diag-twilio-voice` and `ops-twilio-repoint-sms` accept the service role or an active super admin. The diag tools no longer default to a real tenant. | `_shared/internal-auth.ts` |
| Cross-tenant sends | `send-sms-message` and `send-email-message` load the customer, the conversation and the unknown-number thread **inside the caller's tenant**, and return 404 otherwise. They reject deactivated staff. | `_shared/conversation-ownership.ts` |
| TwiML injection | `update-forwarding` accepts a greeting URL only from the tenant's own folder in `voice-greetings`. | `manage-twilio-voice` |
| Logs | Audited every Twilio function: no token, secret or Authorization header is logged. The diag output no longer includes the API key secret's length, and it masks the Account SID. | |

Rollback scripts sit next to each migration as `*.rollback.sql.txt`.

## Probe results (public anon key, a real customer session, a staff session)

The probe script logs in as a dedicated probe customer and a probe staff user (role `ops`) on the internal `test` tenant. Every row it wrote was deleted again. Payloads that went to the send functions targeted customers with no phone number or email on file, so the vulnerable "before" versions stopped before sending anything.

| Check | As | Before | After |
|---|---|---|---|
| read tenants.twilio_auth_token | anon | 401 blocked | 401 blocked (0 tenant rows with a token readable) |
| read tenants.twilio_api_key_secret | anon | 401 blocked | 401 blocked (0 rows readable) |
| read OTHER conversations' messages | anon | 200 EXPOSED (342 rows) | 401 blocked (0 rows) |
| read OTHER chat_channels | anon | 200 EXPOSED (637 rows) | 401 blocked (0 rows) |
| insert into ANOTHER customer's thread as 'tenant' | anon | 201 EXPOSED (row written (deleted again)) | 401 blocked |
| read voicemail_recordings | anon | 200 EXPOSED (52 rows) | 401 blocked (0 rows) |
| list voicemails bucket | anon | 200 EXPOSED (2 top-level entries) | 200 blocked (0 top-level entries) |
| list a private bucket (bonzah-onboarding-files) | anon | 200 EXPOSED (25 entries) | 200 blocked (0 entries) |
| read tenants.twilio_auth_token | customer | 200 EXPOSED (7 tenant rows with a token readable) | 200 blocked (0 tenant rows with a token readable) |
| read tenants.twilio_api_key_secret | customer | 200 EXPOSED (3 rows readable) | 200 blocked (0 rows readable) |
| read OTHER conversations' messages | customer | 200 EXPOSED (342 rows) | 200 blocked (0 rows) |
| read OTHER chat_channels | customer | 200 EXPOSED (636 rows) | 200 blocked (0 rows) |
| insert into ANOTHER customer's thread as 'tenant' | customer | 201 EXPOSED (row written (deleted again)) | 403 blocked |
| read voicemail_recordings | customer | 200 EXPOSED (52 rows) | 200 blocked (0 rows) |
| list voicemails bucket | customer | 200 EXPOSED (2 top-level entries) | 200 blocked (0 top-level entries) |
| list a private bucket (bonzah-onboarding-files) | customer | 200 EXPOSED (same: policy was USING (true) for everyone) | 200 blocked (0 entries) |
| call Vault RPC twilio_get_secrets | anon | n/a (new RPC) | 401 blocked |
| call Vault RPC twilio_get_secrets | customer | n/a (new RPC) | 403 blocked |
| call Vault RPC twilio_get_secrets | staff | n/a (new RPC) | 403 blocked |
| download a recording via public URL | anon | 200 EXPOSED (43507 bytes) | 400 blocked (98 bytes) |
| customer reads OWN thread | customer | 200 ok | 200 ok (0 rows) |
| customer sends in OWN thread | customer | 201 ok | 201 ok |
| customer posts as 'tenant' in own thread | customer | 201 EXPOSED | 403 blocked |
| staff reads OWN tenant channels | staff | — (regression check) | 200 ok (19 rows) |
| staff reads OTHER tenants' channels | staff | not probed (open: RLS was off) | 200 blocked (0 rows) |
| staff reads OWN tenant thread | staff | — (regression check) | 200 ok (0 rows) |
| diag-twilio-a2p as service role (Vault read, Twilio GET) | service | n/a | 200 ok |
| call send-tenant-sms | anon | 400 EXPOSED ({"error":"Missing required fields: tenantId, to, body"}) | 403 blocked |
| call diag-twilio-a2p | anon | 404 EXPOSED ({"error":"Tenant zz-no-such-tenant not found"}) | 401 blocked |
| call diag-twilio-voice | anon | 404 EXPOSED ({"error":"Tenant zz-no-such-tenant not found"}) | 401 blocked |
| call ops-twilio-repoint-sms | anon | 404 EXPOSED ({"error":"Tenant zz-no-such-tenant not found"}) | 401 blocked |
| call send-tenant-sms | customer | 400 EXPOSED ({"error":"Missing required fields: tenantId, to, body"}) | 403 blocked |
| call diag-twilio-a2p | customer | 404 EXPOSED ({"error":"Tenant zz-no-such-tenant not found"}) | 403 blocked |
| call diag-twilio-voice | customer | 404 EXPOSED ({"error":"Tenant zz-no-such-tenant not found"}) | 403 blocked |
| call ops-twilio-repoint-sms | customer | 404 EXPOSED ({"error":"Tenant zz-no-such-tenant not found"}) | 403 blocked |
| call send-tenant-sms | staff | not probed (open: no auth check) | 403 blocked |
| call diag-twilio-a2p | staff | not probed (open: no auth check) | 403 blocked |
| call diag-twilio-voice | staff | not probed (open: no auth check) | 403 blocked |
| call ops-twilio-repoint-sms | staff | not probed (open: no auth check) | 403 blocked |
| staff(test) SMS another tenant's customer | staff | 400 EXPOSED ({"error":"Customer has no phone number on file"}) | 404 blocked |
| staff(test) email another tenant's customer | staff | 400 EXPOSED ({"error":"Customer has no email address on file"}) | 404 blocked |
| staff(test) SMS OWN customer (no phone) | staff | 400 ok | 400 ok |
| staff(test) email OWN customer (no email) | staff | — (regression check) | 400 ok |

Totals after the fix: **0 exposed, 0 regressions** across 43 checks.

### Also verified live

- **Webhook signatures read the Vault token.** I sent `twilio-sms-status` a callback signed with the `test` tenant's token: valid signature → 200; wrong signature → 403; unsigned → 403.
- **Realtime under RLS.**
  - Staff on `test` received an insert in its own tenant and none from another tenant.
  - The customer received an insert in their own channel.
  - `anon` receives only an empty event marked `Error 401: Unauthorized` (Supabase Realtime's behaviour). It learns that an insert happened, but not its content.
- **Automated suite.** `tests/integrations/multi-chat/security.test.ts`, 16 tests. They cover:
  - cross-tenant SMS and email rejected;
  - a channel that belongs to a different customer rejected;
  - an unknown-number thread from another tenant rejected;
  - a super admin limited to the tenant they name;
  - no edge function touching the plaintext columns;
  - every internal tool gated before it reads the body.

## Deploy notes

- 34 functions were redeployed (every importer of the changed shared modules), plus `notify-lockbox-code`.
- **The batch deploy was not trustworthy.** The API reported the new version, but `send-sms-message` kept serving the old code until I redeployed it alone. I then redeployed all 35 functions one at a time and re-ran every probe.
- **`notify-lockbox-code` runs the version that was already live (`f5c2f095`) plus the Vault patch, not repo HEAD.** HEAD contains a committed but never-deployed WhatsApp removal (`3064cc42`), and one tenant still has WhatsApp in its lockbox delivery methods. Shipping that change is the author's call, not a side effect of this fix. When it ships, it already reads through Vault.
- Copies of voicemail files the CDN cached before the bucket went private can keep being served from their old public URL until they expire (default 1h). Uncached requests return 400.

## Residual issues found while doing this (not fixed here)

These are outside Multi Chat. I'm listing them because they are open now.

| Issue | Exposure |
|---|---|
| `tenants.bonzah_password` (28 rows, plaintext) and `tenants.master_password_hash` (8 rows) | readable by **any signed-in session**, the same hole as the Twilio token had. The portal's Bonzah settings read the password client-side, so a fix needs a Bonzah change. |
| `insurance-docs` bucket: SELECT for any `authenticated` | any renter can read every tenant's insurance documents |
| `vehicle-files` bucket: SELECT for role `public`, bucket check only | readable with the anon key |
| `inshur-id-cards` bucket: SELECT for any `authenticated` | any renter can read every tenant's ID cards |
| `lead-inbound-sms-webhook`, `lead-inbound-email-webhook` | public, with no signature check (S8 in the audit). Not Multi Chat tables. |

## Rotating the leaked Twilio credentials

Until today, the stored tokens were readable by any signed-in session. Treat them as leaked. Affected tenants (by slug). All 7 are on the **v1** portal, so they rotate through the legacy Settings screen:

| Tenant | Number | Voice API key also stored |
|---|---|---|
| axis-rentals | +14352529533 | no |
| eastpeakrentalsllc | +18603216867 | no |
| flowrentalsllc | +18557525713 | no |
| jangramrentals | +16624814291 | no |
| openbayrental | +19105699144 | yes |
| revtekrentals | +19043202299 | yes |
| test | +447863772592 | yes |

Note to send each account owner:

> **Action needed: rotate your Twilio Auth Token**
>
> We found and closed a security issue in how Drive247 stored the Twilio credentials you connected. Before the fix, your Twilio Auth Token could have been read by other signed-in users of the platform. We have no evidence it was misused, but please treat it as exposed and rotate it now:
>
> 1. In the Twilio Console, go to **Account → API keys & tokens → Auth tokens**, and choose **Create secondary token**.
> 2. In Drive247, open **Settings → Messaging → SMS** and choose **Disconnect Twilio**. Then fill in the form again: your Account SID, the **new secondary token** and your Twilio number. Choose **Connect** and wait for "Connected". Texts sent to your number in the minute between these two steps may not reach Drive247.
> 3. Back in Twilio, choose **Promote to primary**. The old token stops working.
> 4. If you use calling: in Twilio go to **API keys & tokens**, and delete the key named `Drive247Voice`. Then in Drive247 go to **Settings → Messaging → Calling**, and turn calling off and back on. That creates a fresh key.
> 5. Check **Monitor → Logs** and **Billing → Usage** in Twilio for any messages or calls you don't recognise since you connected, and tell us if you find any.
>
> Credentials are now encrypted at rest and can no longer be read back by anyone, including our staff.
