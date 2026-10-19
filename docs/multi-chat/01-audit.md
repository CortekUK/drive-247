# Multi Chat audit (Step 1)

Date: 2026-10-19. Status: **waiting for approval. No code has been changed.**

Sources: a full read of the portal, booking, edge-function and migration code, plus read-only checks against the production database (`hviqoaokxvlancmftwuo`). Wherever a finding says **LIVE**, I confirmed it in production, not just in the repo.

---

## 0. Fix first: security holes that are open in production now

The header of `20260723090000_lock_down_tenants_rls.sql` says Twilio already suspended accounts once, because tokens were scraped from `tenants`. That fix was only partial. As of today:

| # | Finding | Who can exploit it | Evidence |
|---|---|---|---|
| S1 | Any logged-in account can read **every tenant's plaintext `twilio_auth_token` and `twilio_api_key_secret`**. "Logged-in" includes booking-site customer accounts, because Supabase auth puts them in the same `authenticated` role. 7 tenants have a stored token. | anyone who signs up as a customer on any tenant site | **LIVE**: `has_column_privilege('authenticated','tenants','twilio_auth_token')` returns true; policy `tenants_public_select USING (true)` |
| S2 | `chat_channels` and `chat_channel_messages` have **RLS off**, and `anon` can SELECT and INSERT. Anyone with the public anon key (it ships in every bundle) can read all 342 messages across all tenants, covering SMS, email, call and voicemail metadata, and can insert messages as `sender_type='tenant'` into any conversation. Both tables are in the realtime publication, so new rows also stream live. | anyone on the internet | **LIVE** |
| S3 | `voicemail_recordings` has a policy `FOR ALL USING (true)` granted to PUBLIC. Anyone can read, write or delete any tenant's voicemail rows. | anyone with the anon key | **LIVE** |
| S4 | The `voicemails` storage bucket is **public**, and its SELECT/INSERT/DELETE policies only check the bucket id. Call recordings are stored in it as well. | anyone | **LIVE**: `storage.buckets.public = true` |
| S5 | `send-tenant-sms`, `diag-twilio-a2p`, `diag-twilio-voice` and `ops-twilio-repoint-sms` have no auth check in code. The gateway's JWT check accepts the public anon key. With them, anyone can send SMS from any tenant's number, read a tenant's account data and call history, run paid Lookups, and repoint a tenant's SMS webhook. | anyone with the anon key | code: no auth in the handlers; not in `config.toml`, so default `verify_jwt` |
| S6 | `send-sms-message` and `send-email-message` load the customer, the channel and the unknown-number thread **by id only**, with no tenant filter. Staff at tenant A can text or email tenant B's customers and write into B's conversations, using A's Twilio account. | any staff user of any tenant | `send-sms-message:52-56,73,115-119`; `send-email-message:41-60,104-141` |
| S7 | Every active super admin is rung on **every tenant's** inbound calls, and their forwarding numbers are dialed too when forwarding is on. | (privacy / cost) | `twilio-voice-inbound:182-188, 259-266` |
| S8 | `lead-inbound-sms-webhook` and `lead-inbound-email-webhook` are public, with no signature or secret check. Their lead lookup runs across all tenants. | anyone | `lead-inbound-sms-webhook:115-135` |

Also: the anon-readable column allow-list on `tenants` includes `forwarding_number`, which is the owner's personal mobile.

**Recommendation:** make these fixes the first commit (`security`), before the rename. Also rotate the Auth Token on all 7 connected Twilio accounts, since S1 means the current tokens must be treated as leaked. Rotating is an action on each tenant's own Twilio account; see section 9.

---

## 1. Surface map

### 1.1 Portal (operator) UI

| Area | Files |
|---|---|
| Routes | `apps/portal/src/app/(dashboard)/messages/layout.tsx`, `page.tsx`, `[channelId]/page.tsx` |
| Inbox UI | `components/messages-v2/*`: `conversation-rail`, `conversation-view`, `timeline-item`, `customer-context`, `messages-sheet-v2` (top-bar sheet), `bulk-select`, `attach-menu`, `attachment-list`, `use-chat-attachments`, `contact-edit-dialog`, `contact-override`, `trax-*` (AI reply suggestions) |
| Call UI | `components/messages-v2/phone-call-preview.tsx` (iPhone mock), `call-record.tsx` (scripted record), `components/chat/VoiceCallBar.tsx` (real overlay), `components/voice/global-voice-call-provider.tsx` (incoming calls, mounted in `(dashboard)/layout.tsx:901`) |
| v1 chat leftovers | `components/chat/ChatMessageBubble.tsx` (`VoiceCallCard`, `VoicemailPlayer`), `call-transcript-dialog.tsx`, `LinkUnknownThreadDialog.tsx`, `BulkMessageModal.tsx`; `ChatWindow.tsx` / `ChannelList.tsx` are dead |
| Rental tab | `components/rentals-v2/rental-detail/rail-messages.tsx` |
| Entry point | `components/shared/layout/top-bar-v2.tsx:596-616` (badge from `hooks/use-unread-count.ts`) |
| State / hooks | `contexts/RealtimeChatContext.tsx`, `hooks/use-chat-channels.ts`, `use-chat-messages.ts`, `use-voice-call.ts` (`@twilio/voice-sdk`), `use-twilio-voice.ts`, `use-twilio-sms.ts`, `use-customer-rentals.ts` |

### 1.2 Integration setup UI

There are **two UIs**:
- **v2 Integrations board.** `app/(dashboard)/integrations/page.tsx` returns 404 unless the tenant is on v2. Files: `_panels/twilio-setup.tsx` (account and number flow), `twilio-calling.tsx`, `twilio-messages.tsx` + `twilio-messages-data.ts`, `twilio-test-ring.tsx`, `twilio-test-text.tsx`, `_screens.tsx`, `_kit.tsx`, `registry.ts`, `_intros.ts`, `integrations-board.tsx`.
- **Legacy Settings › Messaging.** Used by non-v2 tenants: `components/settings/communication-settings.tsx`, `twilio-sms-settings.tsx`, `call-forwarding-settings.tsx`.
- **Admin app:** there is no Twilio UI, only pricing keys in `apps/admin/lib/integration-pricing.ts`.

### 1.3 Customer side (booking app)

| Tenant | Live portal | Chat code |
|---|---|---|
| everyone except `northwind` | `(legacy)/(customer-portal)/portal/messages` | `contexts/CustomerRealtimeChatContext.tsx`, `hooks/use-customer-chat.ts`, `use-customer-unread.ts` |
| `northwind` | `(northwind)/northwind-site/(portal)/portal/messages` | `northwind-site/hooks/use-customer-messages.ts` (realtime plus a 6s/25s poll) |
| `northwind`, preview | `portal-v2/messages` | copy of the above; not routed to from `/portal` |

The root `v2/` directory is only build cache and contains no source.

### 1.4 Edge functions

| Function | Trigger | Role |
|---|---|---|
| `twilio-numbers-v2` | portal | `verify`, `search` (US/CA/GB only), `buy`, `connect` |
| `manage-twilio-connection` | portal | `connect` (legacy UI), `test`, `get-status`, `disconnect` |
| `manage-twilio-voice` | portal | `setup` (creates API key + TwiML App), `get-token`, `get-status`, `disable`, `update-forwarding`, `set-forwarding-number`, `preview-forward-call`, `test-forward-call` |
| `twilio-voice-test-v2` | portal | `ring-me` |
| `twilio-voice-inbound` | Twilio VoiceUrl | inbound TwiML: ring softphones + forwarding, then voicemail |
| `twilio-voice-connect` | TwiML App VoiceUrl | outbound browser calls |
| `twilio-voice-status` | Twilio status callback / Dial action | writes `call_logs` and the chat "voice call" row |
| `twilio-voice-whisper` | `<Number url>` | business-line whisper |
| `twilio-voicemail-handler` | Dial/Record action | voicemail record + store |
| `process-call-recording` | recordingStatusCallback | download, Whisper transcription, GPT summary |
| `twilio-inbound-sms` | Twilio SmsUrl | inbound SMS → conversation or unknown thread |
| `twilio-sms-status` | per-message StatusCallback | delivery status |
| `send-sms-message`, `send-email-message` | portal composer | v1 senders (see S6) |
| `send-conversation-message-v2` | portal composer (one-off override only) | correctly tenant-scoped |
| `send-tenant-sms` | `notify-*` functions | system SMS (see S5) |
| `ops-twilio-repoint-sms`, `diag-twilio-a2p`, `diag-twilio-voice` | ops | see S5 |
| `customer-chat` | booking app | Trax AI assistant only, **not** human chat; auth is correct |
| `lead-inbound-sms-webhook`, `lead-inbound-email-webhook` | public | Lead CRM, separate tables (S8) |

Shared helpers: `_shared/twilio-signature.ts` (good: HMAC with constant-time compare, fails closed), `twilio-sms-client.ts`, `twilio-recording-url.ts` (good: pins recording URLs to the tenant's own account), `openai.ts`.

### 1.5 Tables

| Table | Notes |
|---|---|
| `tenants` | all Twilio config is columns on this table, so **one number per tenant**: `twilio_account_sid`, `twilio_auth_token` (plaintext), `twilio_phone_number(_sid)`, `twilio_api_key_sid/secret` (plaintext), `twilio_twiml_app_sid`, `twilio_voice_enabled`, `integration_twilio_sms`, `twilio_connection_verified_at`, `call_forwarding_enabled`, `forwarding_number`, `forwarding_caller_id_mode`, `voicemail_enabled`, `voicemail_greeting_url`, `call_recording_enabled`. **No unique constraint on the number.** |
| `app_users.forwarding_number` | per-user forwarding legs (no UI) |
| `call_logs` | RLS correct. `twilio_call_sid` index is **not unique**. Has `recording_url/sid`, `transcript`, `ai_summary`, `ai_action_items`. 780 rows, 2 with recordings. |
| `voicemail_recordings` | S3; no unique key on `twilio_recording_sid` |
| `chat_channels`, `chat_channel_messages` | S2. `external_status` CHECK allows only 5 Twilio statuses. `external_id` is not unique. Messages have no `tenant_id`. |
| `chat_channel_participants` | dead; nothing reads it |
| `sms_unknown_threads`, `sms_unknown_messages`, `sms_message_log` | RLS correct; code writes `sms_unknown_messages.channel/metadata`, which no migration creates |
| `customers.sms_consent`, `rentals.sms_consent` | collected, **never checked when sending** |
| storage `voicemails`, `chat-attachments` | S4 |

There is no opt-out/suppression table, no audit log for integration changes, no phone-numbers table, and no usage/cost table for Twilio.

---

## 2. Mocks, stubs, hardcoded values and dead code

### 2.1 Mocks that real tenants can see in production

| Mock | Where | Who sees it |
|---|---|---|
| Fake previews, times and unread counts on empty conversations, which also inflate the header count | `messages-sheet-v2.tsx:55-103`. There is no gate; a comment says to delete it once real conversations exist. | every v2 tenant |
| iPhone call screen: 2.8s fake connect; mute, hold, keypad and speaker are local state only; keypad digits go nowhere | `phone-call-preview.tsx` | any v2 tenant without voice, **and** a voice-enabled tenant who clicks Call before the voice status has loaded (`conversation-view.tsx:305`, `rail-messages.tsx:349`) |
| Scripted call record: silent fake player with a seeded waveform, a 2.2s fake "AI writing" delay, 4 hardcoded transcript/summary/checkpoint/action scripts picked by regex, a client-generated .txt "download", stored in sessionStorage | `call-record.tsx`, `conversation-view.tsx:841-851` | same as above |
| Canned AI reply suggestions shown as if they came from the model whenever `trax-reply-suggest` is loading, errors or returns nothing | `trax-reply-suggestions.ts`, `use-trax-replies.ts:63-67` | all v2 |
| Contact override saved only in sessionStorage, never in the DB | `contact-override.ts` | all v2 |
| Made-up booking ref `RNT-${id.slice(0,6)}` | `attach-menu.tsx:45` | all v2 |
| Header "Call" button is a `tel:` link that bypasses Twilio | `conversation-view.tsx:563-566` | all |

### 2.2 The `northwind` demo

On slug `northwind`, the whole Twilio setup is simulated in the browser:
- fake SID and token;
- fake owned numbers `+14155550142` and `+16285550199`;
- generated 555-01XX search results and a fake price of "1.15 USD";
- fake buy and connect;
- fake TwiML/API-key SIDs;
- a fake ring test using a synthesised ringtone and browser text-to-speech;
- fake test SMS.

Files: `twilio-setup.tsx:56-187, 222-262, 624, 652, 818`, `twilio-calling.tsx:127-142, 457-474, 877-891`, `twilio-test-ring.tsx`, `twilio-messages.tsx:69-78, 232-241, 464`.

**In the production DB, `northwind` has no Twilio account.** The "Northwind number" in the demo is one of these fakes.

### 2.3 Real code that is broken or half-wired

- **Every real call shows as "Outgoing call" and missed calls never show.** The v2 call row reads `direction==='incoming'` and `outcome==='missed'`, but the backend writes `'inbound'` and `status`, and no `outcome` (`timeline-item.tsx:59-60` vs `twilio-voice-status:149-157`).
- **Voicemails get no player in v2**, and **no real recording can be played or downloaded in v2**. The v1 `VoicemailPlayer` and `VoiceCallCard` never render there.
- **Missed inbound calls are recorded as `completed`.** `DialCallStatus` is never stored (`twilio-voice-inbound`, `twilio-voice-status`).
- **Child call legs create bogus `call_logs` rows**, defaulted to outbound/tenant (`twilio-voice-status:75-101`).
- **Hold** is `call.mute(true)`; the code comments say real hold isn't implemented. **DTMF, transfer and device/mic selection don't exist** in the real call overlay. The SDK edge is hardcoded to `ashburn`.
- **Each `useVoiceCall()` creates its own Twilio Device.** On `/messages/[id]` 2 or 3 Devices register under the same identity, and each one draws its own full-screen incoming-call overlay.
- **The incoming overlay sticks if the caller hangs up first**: there's no `cancel` listener before the call is answered. **A second inbound call during a call is invisible**, and accepting it would orphan the first call.
- **Manager and ops users are rung on inbound calls but can't get a softphone token**, because the role gate runs before `get-token` (`manage-twilio-voice:231`).
- **Token refresh** is `tokenWillExpire` plus a one-shot 50-minute timer that doesn't repeat. There are no `registrationFailed` or `unregistered` handlers. A denied mic only produces a `console.error`.
- **The recording consent `<Say>` on outbound calls plays to the agent leg, not the customer** (`twilio-voice-connect:166-168`).
- **Recording URLs don't work.** `getPublicUrl` is used, and only works because the bucket is public (S4). Download failures fall back to the auth-required Twilio URL.
- **`process-call-recording`** has no idempotency, retries, chunking (Whisper's 25MB cap) or language handling, and writes `'[Transcription failed]'` on error. The summary is plain JSON parsed with a regex.
- **Inbound TwiML puts forwarding numbers, the greeting URL and the company name in without XML escaping**: a tenant name with `&` breaks the call (`twilio-voice-inbound:295, 377-379`).
- **A bare 10-digit US number is sent without `+1`** (`normalizePhoneNumber`).
- **SMS has no segment count, no STOP/HELP/opt-out handling, no consent check, no A2P/21610/30007 error mapping, no MMS, and no MessagingService.**
- **The `external_status` CHECK rejects `accepted`, `sending`, `scheduled`, `read`, `canceled` and `partially_delivered`.** Late callbacks can overwrite `delivered` with `sent`.
- **No handler is idempotent on CallSid, MessageSid or RecordingSid.** `.single()` lookups throw when a duplicate exists.
- **No 429 or backoff handling** in any Twilio or OpenAI call.
- **Operator-side mark-read calls from the view pass a customer id where a channel id is expected**, so they never match a row (`conversation-view.tsx:314,326`, `rail-messages.tsx:356,363`). Read state still works through `use-chat-messages`.
- **The composer can send in-app without the operator choosing it.** If the last channel was `voice` (or `whatsapp`), the composer opens with no button selected and sends as in-app (`conversation-view.tsx:274, 404` + `RealtimeChatContext.tsx:465`).
- **Bulk send from the modal inserts rows with no `channel`.**
- **On the customer side:**
  - The legacy unread badge counts operator SMS and email too, but the thread only shows in-app.
  - Northwind has no unread badge at all.
  - The notification trigger fires for every channel and links to a thread that won't show SMS or email.
  - Nothing emails or pushes the customer about a new in-app message.
- **Email:** no `reply_to` is set and the footer says "do not reply". **No inbound path brings a customer's email reply back into the conversation, and no bounce webhook is consumed.** `send-email-message:88` puts unescaped content into the HTML.
- **Setup UI:**
  - The country list is US/CA/GB only (**no Pakistan**).
  - The default country always falls back to US, because `TenantContext` never loads `country`.
  - Number search always filters `voice: true`.
  - `prettyNumber` only formats +1 numbers.
  - "Test" doesn't update any last-verified time.
  - Calling shows no verified time at all.
  - **Ring timeout is not configurable**; it's hardcoded at 30s in TwiML.
  - "30 seconds" is hardcoded in the copy.

### 2.4 Hardcoded values, dead code and TODOs

- Default diag slug `revtekrentals`, and a real forwarding number `+19046357309` and campaign `CU07SL8` in comments (`diag-twilio-*`).
- Preview defaults `+15550000000`; `Polly.Joanna`; nil-UUID sender; `noreply@drive-247.com`.
- `validateTwilioSignature()` stub that always returns true, with a TODO (`twilio-sms-client.ts:258-269`; nothing imports it).
- `CREDIT_CONFIG.SERVICES.twilio`, which nothing deducts.
- `hasSubaccount` aliases.
- A config entry for `twilio-inbound-whatsapp`, which doesn't exist as a function.
- `useTwilioConnect`, `ForwardingNumberRow`, `SmsDeliveryStatus`, `ChatWindow`, `ChannelList`, `chat_channel_participants`, presence and typing (joined but never drawn in v2), `isDeviceReady` (reads a ref, so it never triggers a re-render).
- The CLAUDE.md line about platform `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` is out of date; nothing reads them.
- `PENDING_20260903_drop_whatsapp.sql.txt` has not been applied.

---

## 3. Every "Crossroad" occurrence

Only the plural "Crossroads" appears, and only in 5 places in UI strings and comments:

| File | Line | Kind |
|---|---|---|
| `apps/portal/src/components/messages-v2/conversation-rail.tsx` | 267 | comment |
| same | 270 | heading `{v2Name ? "Crossroads" : "Messages"}` |
| `apps/portal/src/components/messages-v2/messages-sheet-v2.tsx` | 189 | sheet title |
| `apps/portal/src/components/shared/layout/top-bar-v2.tsx` | 597 | tooltip |
| same | 603 | aria-label |

The name does **not** appear in routes (the route is `/messages`), i18n files (there are none), DB objects, edge functions, docs or tests. **So the rename needs no DB migration.** The only route decision is whether `/messages` becomes `/multi-chat` (question Q5).

---

## 4. Tenant-safety findings

These are in addition to S1–S8.

| Finding | Location |
|---|---|
| `chat_channel_messages` has no `tenant_id`; every query scopes by `channel_id` only, and RLS is off | `use-chat-channels.ts:93,101`, `use-chat-messages.ts:61`, `RealtimeChatContext.tsx:258,433,515`, `use-unread-count.ts:118` |
| The portal realtime subscription receives **every tenant's** message inserts and filters them in the browser | `RealtimeChatContext.tsx:147-166` |
| Presence and typing topics are `chat:<customerId>:*`, with no tenant and no private channels | `RealtimeChatContext.tsx:270,280`, customer contexts |
| Updates by id only: `chat_channels`, `sms_unknown_threads`, `customers` | `RealtimeChatContext.tsx:499,580`, `LinkUnknownThreadDialog.tsx:76-160` |
| `call_logs` read by `twilio_call_sid` only (RLS protects it, but it's fragile) | `call-transcript-dialog.tsx:55` |
| Inbound webhooks resolve the tenant by the To number only. They don't check that the signed AccountSid belongs to that tenant, and there's no unique constraint on the number, so a duplicate makes `.single()` fail and the call or SMS is dropped. | `twilio-inbound-sms:55-73`, `twilio-voice-inbound:76-96` |
| Two tenants on one Twilio account break `voice-connect` (`.single()`), while signature lookup takes `limit(1)` | `twilio-voice-connect:71-75`, `twilio-signature.ts:203-215` |
| Customer phone matching uses `endsWith(digits)`, which can pick the wrong customer in the same tenant | `voice-inbound:144`, `inbound-sms:117`, `voice-connect:119` |
| CallSid and `external_id` lookups in webhooks are global, not tenant-scoped | `voice-status:66-70`, `process-call-recording:53-57`, `sms-status:54-70` |
| The client sends `tenantId` in edge-function bodies; it is honoured only for super admins (correct), but `send-sms-message` and `send-email-message` don't scope the records they touch (S6) | |
| `twilio-numbers-v2` sends the typed token from the browser again on every search, buy and connect | `twilio-setup.tsx` |
| sessionStorage keys (contact override, call records) carry no tenant id | `contact-override.ts`, `call-record.tsx` |
| The Sending switch writes `tenants.integration_twilio_sms` directly from the browser | `twilio-messages-data.ts:465-480` |

---

## 5. Production snapshot (read-only)

- **Twilio-connected tenants:**

  | Tenant | Number | Voice |
  |---|---|---|
  | `test` | `+447863772592` (UK) | on |
  | `revtekrentals` | `+19043202299` | on |
  | `openbayrental` | `+19105699144` | on |
  | `jangramrentals` | `+16624814291` | off |
  | `flowrentalsllc` | `+18557525713` (toll-free) | off |
  | `eastpeakrentalsllc` | `+18603216867` | off |
  | `axis-rentals` | `+14352529533` | off |

  SMS is on for all of them.
- **No tenant has a Pakistan number attached**, and `northwind` has no Twilio at all.
- `chat_channel_messages`: 342 rows (in_app 108, sms 132, voice 64, email 12, whatsapp 26).
- `call_logs`: 780 rows, 2 with recordings.

---

## 6. Proposed design changes (needed to meet the spec)

1. **New table `tenant_phone_numbers`.** One row per attached number: `tenant_id`, `e164`, `twilio_sid`, `account_sid`, `country`, `capabilities`, `use_for_voice`, `use_for_sms`, `forwarding_number`, `ring_timeout_seconds` (default 20), `forwarding_enabled`, `webhooks_verified_at`, `status` (active / released / misconfigured). It gets a **global UNIQUE on `e164`** and on `twilio_sid`, so one number can't be attached to two tenants. The current `tenants.twilio_*` columns stay as a compatibility view for the 15 `notify-*` senders until they are migrated. The migration is reversible.
2. **Secrets move to Supabase Vault**, using the same pattern `tesla_*_secret_id` already uses: `twilio_auth_token_secret_id` and `twilio_api_key_secret_id`. The plaintext columns are nulled once the Vault copy is verified. Reversible, but the down-migration has to restore the values from Vault.
3. **New tables:**
   - `sms_suppressions` (tenant, e164, reason, source keyword, created_at);
   - `integration_audit_log`;
   - `call_ai_outputs` (call_id UNIQUE, summary, checkpoints, action items, model, status, attempts);
   - `twilio_webhook_events` (sid + event type + status UNIQUE), used for idempotency.
   - `call_logs.twilio_call_sid` and `chat_channel_messages.external_id` become UNIQUE; `chat_channel_messages` gains `tenant_id`.
4. **RLS turned on** for the chat tables, voicemails and the storage bucket. The customer portal writes through policies scoped to its own `customer_users` link. Messages go to realtime over private, tenant-scoped channels.
5. **One shared Twilio client** with 429/5xx backoff and error-code mapping: 21610 opt-out, 21408/21612 geo permission, 30007/30034 A2P, 21422/21452 number unavailable, 21631/21649 regulatory bundle or address.
6. **One shared Device** (a single provider) for the voice SDK. Hold becomes a real server-side hold (conference or `<Enqueue>`). DTMF uses `call.sendDigits`.
7. **Inbound routing:** ring the clients **and** the forwarding number in sequence: `<Dial timeout=N><Client/></Dial>`, then on no-answer `<Dial><Number/></Dial>`, then voicemail. The forwarding hop is server-side, so it still happens when every browser is closed. Loop guard: refuse forwarding to any number in `tenant_phone_numbers`. Plus a `?hop=` counter.

---

## 7. Edge cases from the spec, mapped to plans

Short version. Each edge case will get either code plus a test, or a documented reason it's out of scope.

- **Can be fully covered with automated tests** (Twilio fixtures and a mocked client):
  - signature rejection;
  - idempotency on SID and out-of-order status;
  - tenant A/B isolation;
  - number already attached;
  - capability mismatch;
  - no integration configured;
  - invalid/revoked credentials (20003);
  - purchase failures (21422, 21452, 21631, balance 20005);
  - STOP/START/HELP;
  - segment counting for GSM-7 vs UCS-2 and emoji;
  - E.164 normalisation for US/UK/PK;
  - forwarding loop;
  - each `DialCallStatus` and `CallStatus` mapped to its own UI status;
  - zero-duration calls;
  - recording callback before or after the call closes;
  - recording still processing;
  - empty or low-confidence transcripts;
  - chunking a long transcript;
  - AI retry/backoff/degradation and idempotent generation;
  - 429 backoff;
  - unknown inbound number;
  - delivery receipts arriving out of order.
- **Can only be checked manually** (in the manual matrix):
  - mic denied or no input device;
  - laptop asleep or tab closed → forwarding;
  - network drop and reconnect;
  - token refresh during a long call;
  - simultaneous inbound calls;
  - real geo permissions;
  - A2P 10DLC blocking;
  - real UK/PK regulatory flows.
- **Out of scope unless you say otherwise:**
  - **Call transfer.** There is no transfer control in the UI, and adding one would change the UI.
  - **Device/mic selection UI.** Same reason; see Q3.
  - **Urdu transcription quality.** I'll pass `language` hints and keep the raw transcript, but Whisper's Urdu/English mixed accuracy is not something code can fix.

---

## 8. Proposed commit order

`security` → `rename` → `integration` (Vault, verify, status, audit log) → `numbers` (phone-numbers table, buy/attach/admin, US/UK/PK) → `forwarding` → `calling` (single Device, real controls, statuses) → `recording` → `AI` → `messaging` (SMS status/opt-out/segments, in-app read state and unread, channel selector) → `tests` (automated suite, `docs/multi-chat/manual-test-matrix.md`, seed script).

---

## 9. Account actions you'll need to take (preliminary)

- **Rotate the Auth Token** on all 7 connected Twilio accounts (because of S1). The owners have to do this in their Twilio console; the app can't.
- **US SMS:** an A2P 10DLC brand and campaign for local numbers, or toll-free verification for `+1855…`. Without it, carriers block messages with error 30034/30007.
- **UK numbers:** a regulatory bundle (proof of address in the UK) before purchase.
- **Pakistan:** see Q1.
- **Geo permissions** (voice and SMS) for PK and UK on any account that calls or texts them.
- **Enough Twilio balance** for the test numbers and calls.
- **An OpenAI key with quota** for transcription and summaries (it is already used).

---

## 10. Questions that block implementation

- **Q1. Pakistan.** To my knowledge, Twilio doesn't sell Pakistani local or mobile numbers, and outbound SMS to Pakistan generally needs a registered sender. No tenant has a PK number attached today. When you say "already-configured PK numbers", do you mean:
  - (a) numbers on a different provider;
  - (b) PK mobiles used as the **customer** and **forwarding** side, while the Twilio number is US/UK; or
  - (c) a Twilio account that actually holds PK inventory?

  I can add PK to search and buy either way, but if it's (b), the "PK to PK" test row is really "US/UK Twilio number ↔ PK handsets".
- **Q2. The northwind demo.** Do I delete the simulated Twilio flow on `northwind` and connect it to a real Twilio account, or keep a clearly-labelled demo mode for sales and de-mock everything else?
- **Q3. "Don't change the UI" vs features that have no UI.** Several required features have no control in the current UI:
  - ring timeout;
  - per-tenant recording-consent toggle;
  - number list (needed once there are several numbers);
  - admin attach;
  - mic/device picker;
  - DTMF in the real call overlay;
  - recording download in v2.

  Can I add these using the existing components and patterns (no new styles or layouts), or do you want them left out and listed as gaps?
- **Q4. Two setup UIs.** Do I finalise only the v2 Integrations board, and keep legacy Settings › Messaging working on the new backend, or bring both up to spec?
- **Q5. Route.** Should `/messages` become `/multi-chat`, with `/messages` redirecting to it, or stay as it is with only the labels renamed?
- **Q6. Email replies.** "Verify only, confirm replies thread correctly" can't pass right now, because there is **no inbound path at all** and the footer says "do not reply". Do I:
  - (a) add Resend inbound (a reply-to address per conversation, plus a webhook that writes into the thread) and bounce webhooks, which touches only the receiving side and leaves the sending service alone; or
  - (b) leave email as it is and document it as failing?
- **Q7. Security first.** OK to ship section 0 as the first commit right away, applied to production the way you've had me apply migrations before? It changes RLS on live tables, so I'll test it against the anon and customer keys before and after.
