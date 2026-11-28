# Spec 05 · The session, sending the link, and the progress screen

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 4, 5, 9, 10 · **Status:** Draft

## What this covers

Making a session, the four ways of sending its link, the 24-hour life, one open session per
customer, reminders, cancel, the limits, the moments, and the dialog's screens 2 and 3. The pages the
renter sees are spec 06.

## Behaviour

- **05.1** `start` makes one `verification_sessions` row with status `link_sent`, `expires_at = created_at + 24 hours`, a new random token, and one `verification_session_checks` row per ticked service with its price frozen (spec 09).
- **05.2** `start` with `sentVia = 'email'` emails the link to the given address and records `link_emailed` with the address.
- **05.3** The email address may be corrected on screen 2 before sending. With "Save this email on the customer" ticked (the default), the customer's email is updated too; unticked, only this session uses it.
- **05.4** `sentVia = 'email'` is refused with 400 `no_email` when no address is given.
- **05.5** `sentVia = 'sms'` texts the link through the company's own Twilio number and records `link_texted`. It is refused with 400 `sms_not_available` when `tenants.integration_twilio_sms` is false or the customer has no phone.
- **05.6** `sentVia = 'qr'` records `code_shown`; `sentVia = 'copy'` records `link_copied`. Both return the link to the dialog and send nothing.
- **05.7** The link is `<booking origin>/id/<token>`. The booking origin comes from `_shared/booking-origin.ts` (`deriveBookingOrigin`), so a session made on staging or a ray site links to that site's booking pages, never to live.
- **05.8** Starting a session for a customer who has an open one ends the old one: its status becomes `not_verified`, `replaced_by` points at the new one, a `replaced` moment is recorded, and its Didit session, if one was made, is deleted at Didit (`deleteSession`, spec 07).
- **05.9** At most 10 sessions are made per customer per rolling hour. The 11th `start` is refused with 429 `too_many`. If the count cannot be read, the start is refused (it never lets the request through on an error).
- **05.10** `resend` sends the same link again, by the same or another way, without making a new session. It records `reminder_sent`.
- **05.11** At most 3 reminders per session, and not within 60 seconds of the last one. Beyond that `resend` is refused with 429.
- **05.12** `cancel` sets the session to `not_verified`, sets `cancelled_at` and `cancelled_by`, records `cancelled`, and charges nothing that has not finished.
- **05.13** A session that reaches `expires_at` while `link_sent` or `in_progress` is set to `expired` by the sweep within 10 minutes, and records `expired`. Nothing unfinished in it is charged.
- **05.14** Every moment is a `verification_session_events` row with its time. Screen 3 lists them in time order.
- **05.15** Every `start`, `resend` and `cancel` writes an audit entry (`verification_started`, `verification_reminded`, `verification_cancelled`) with the staff member and the session.
- **05.16** The customer's `verification_status` and `identity_verification_status` follow the latest session through `verification_v2_set_customer_status` (spec 03.8). A session that was replaced can never change them again.
- **05.17** `start`, `resend` and `cancel` refuse a customer of another company with 404, and a session of another company with 404.
- **05.18** The SMS text is: "<Company>: please verify your driving licence for your rental. It takes about a minute: <link>". The email uses the company's name and logo, as `send-verification-link-v2` does today.

## Worked examples

None.

## Database

Spec 01's tables. `verification_v2_set_customer_status(p_customer, p_session, p_status)`: a
`security definer` function, service role only, that updates `customers.verification_status`,
`identity_verification_status` (03.8 mapping) and `verification_session_id`, and does nothing when
`p_session` is not the customer's latest session (05.16).

Scheduled job: `verification-v2-sweep` every 5 minutes (pg_cron calling the edge function with the
service key from Vault), for 05.13 and the fallbacks in specs 07, 08 and 10.

## Functions

`verification-v2` (staff JWT, `verify_jwt` on). Actions:

| Action | Input | Output | Errors |
|---|---|---|---|
| `context` | spec 04 | spec 04 | spec 04 |
| `start` | `{ customerId, services[], sentVia, sendTo?, saveEmail? }` | `{ sessionId, link, expiresAt }` | 400 `no_email`, `sms_not_available`, `bad_services`; 402 `subscription_required`; 403 `not_enabled`, `not_allowed`, `premium_not_allowed`; 404; 429 `too_many` |
| `resend` | `{ sessionId, sentVia, sendTo? }` | `{ ok }` | 404; 409 `not_open`; 429 |
| `cancel` | `{ sessionId }` | `{ ok }` | 404; 409 `not_open` |
| `status` | `{ sessionId }` | `{ status, events[], checks[] }` | 404 |

`verification-v2-sweep` (service role only): expires sessions, and runs the fallbacks of specs 07, 08, 10.

Email: built like `send-verification-link-v2` (Resend, the company's branding), but the link comes
from `deriveBookingOrigin`. SMS: `_shared/twilio-sms-client.ts` `sendTenantSMS`.

## Screens

Portal, `verify-dialog-v2.tsx`:

- **Screen 2, "How does <first name> do it?"**: Email him the link (only with an email; the address
  editable, with the save tick), Text him the link (only with a phone and texts switched on), He is
  here: show a code to scan (always), Copy the link (always). The session is made when one is chosen.
- **Screen 3, "<first name> is verifying"**: the moments with times, filling in as they happen
  (polling `status` every 3 seconds while open). Buttons: Send again, Cancel this check, Close.
- Closing the dialog leaves the session running; the row and the page show the same progress.

## Money and safety

Sessions cost nothing until a premium check finishes. The limits (05.9, 05.11) stop a customer being
flooded and stop runaway Didit sessions. The token is never logged.

## Proof

| Statement | Proved by |
|---|---|
| 05.1, 05.4, 05.5 (refusal), 05.6 to 05.17 | `evals/05-session-and-sending.mjs` (email to a `@drive-247.test` address is checked by the event row, never delivered) |
| 05.2, 05.3, 05.5 (delivery), 05.18 | QA report (a real email and a real text received) |

## Not in this spec

- What the renter's pages do (spec 06), the Didit and RentID parts (specs 07, 08).
