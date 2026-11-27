# Spec 07 · The emails and the calendar invites

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 5, 6, 7, 9, 10, 11, 12, 16, 25, 27, 28, 29 · **Status:** Draft

## What this covers

What each email says, who it goes to, the calendar invite it carries, and the "Add to calendar"
link. When they are queued is in specs 04 to 06; how they are sent is spec 08.

## Behaviour

**Who gets what**

| Kind | To | Subject |
|---|---|---|
| `booked_company` | the booking's email | `Your onboarding call with Bryan: <short time>` |
| `booked_host` | Bryan's settings email | `New onboarding call: <company>, <short time in Bryan's zone>` |
| `moved_company` | the booking's email | `Your onboarding call has moved to <short time>` |
| `moved_host` | Bryan | `Onboarding call moved: <company>, <short time in Bryan's zone>` |
| `cancelled_company` | the booking's email | `Your onboarding call is cancelled` |
| `cancelled_host` | Bryan | `Onboarding call cancelled: <company>` |
| `reminder_day` | the booking's email | `Tomorrow: your onboarding call with Bryan` |
| `reminder_hour` | the booking's email | `In one hour: your onboarding call with Bryan` |
| `missed` | the booking's email | `Sorry we missed you` |

- 07.1 Each kind goes to the recipient in the table above.
- 07.2 Each kind's subject is as in the table above, with `<short time>` in the form of spec 03.7.
- 07.3 A company's email gives every time in the booking's saved zone (spec 03.5), with the zone's name.
- 07.4 Bryan's email gives the time in his zone first and the company's time and zone beside it (`9:00 AM New York time · 7:00 PM Karachi time`).
- 07.5 When Bryan has no email set, his kinds are recorded as `skipped` with the reason `No host email set`, and the company's emails still go.
- 07.6 Every email uses the shared Drive247 look, `framed: true`. It is sent from `Drive247 <support@drive-247.com>`.
- 07.7 `booked_company` carries: a date tile, the full time, a Join button with the call link, an Add to calendar button, and one line `Need another time? Move or cancel your call.` linking to the portal (07.15). It is no longer than one phone screen of text.
- 07.8 With no call link set, the Join button is replaced by `Bryan will send you the call link before the call.`
- 07.9 `booked_host` carries the company, the person, their email and phone, their note, both times, Join and `Open Call Calendar`.
- 07.10 `moved_*` shows the old time struck through above the new one.
- 07.11 `cancelled_*` says who cancelled (`You cancelled`, `<company> cancelled` or `Bryan cancelled`) and the reason when one was given. `cancelled_company` has a `Book a new time` button to the portal calendar.
- 07.12 `reminder_*` shows the time and Join. `missed` has one line and a `Book a new time` button.
- 07.13 No email contains an emoji, an em dash or an en dash.
- 07.14 Every text that came from a person (name, note, company, reason) is HTML-escaped.
- 07.15 Portal links go to the company's own portal: `https://<slug>.<PORTAL_ROOT_DOMAIN>/?call=open` for move or cancel, `?book-call=1` for booking again. `PORTAL_ROOT_DOMAIN` defaults to `portal.drive-247.com`.

**The invite**

- 07.16 `booked_*` and `moved_*` carry `invite.ics` with `METHOD:REQUEST`; `cancelled_*` with `METHOD:CANCEL` and `STATUS:CANCELLED`. The attachment's type is `text/calendar; method=REQUEST` (or `CANCEL`).
- 07.17 The company's invite `UID` is `<booking id>@drive-247.com` (Bryan's is in 07.19), the same for the life of the booking, so a move updates the same event and a cancel removes it.
- 07.18 Its `SEQUENCE` is the booking's `sequence` at the time.
- 07.19 In the company's invite, `ORGANIZER` is Bryan (his name and settings email, else `support@drive-247.com`) and `ATTENDEE` is the booking's person and email, `RSVP=TRUE`. Bryan's own invite is a separate event (`UID` `<booking id>-host@drive-247.com`) with Drive247 (`support@drive-247.com`) as `ORGANIZER` and Bryan as `ATTENDEE`, because Outlook does not add an invite by itself for its own organiser.
- 07.20 `DTSTART` and `DTEND` are in UTC (spec 03.12). The invite has `SUMMARY`, the call link as `LOCATION` and in `DESCRIPTION`, and lines no longer than 75 octets, folded as RFC 5545 says.
- 07.21 Text in the invite is escaped (`\`, `;`, `,`, new lines).

**Add to calendar**

- 07.22 `GET /functions/v1/onboarding-call-ics?t=<ics_token>` returns the booking's invite with `Content-Type: text/calendar` and `Content-Disposition: inline; filename="drive247-onboarding-call.ics"`. An iPhone opens it in Calendar.
- 07.23 An unknown or malformed token gets `404` with no body. A cancelled booking returns a `METHOD:CANCEL` invite.
- 07.24 The emails and the booked screen offer Google (a `calendar.google.com/calendar/render` link), Outlook (an `outlook.live.com/calendar/0/deeplink/compose` link) and Apple or other (07.22).

## Worked examples

None.

## Database

None beyond spec 01.

## Functions

- `supabase/functions/_shared/onboarding-call-emails.ts`: `buildCallEmail(kind, ctx) → { to, subject, html, ics?: { method, content } }` and `buildCallIcs(ctx, method)`. Pure: no network, no `Deno`, so Vitest runs it.
- `supabase/functions/_shared/resend-service.ts`: `sendResendEmail` gains `attachments?: { filename, content (base64), contentType }[]`, passed through to Resend.
- `onboarding-call-ics` edge function, `verify_jwt = false` (it is opened from email and calendar apps). Reads the booking by token with the service role. GET only; other methods `405`.

## Screens

The booked screen's buttons: spec 09.

## Money and safety

No money. The ICS link exposes only that booking's time, title, call link and Bryan's name, and
only to someone holding its random token. No email goes to a person other than the booking's own
email and Bryan.

## Proof

| Statement | Proved by |
|---|---|
| 07.1 to 07.21, 07.24 | `evals/07-emails-and-invites.test.ts` (each kind built from a fixed booking) |
| 07.5 | `evals/08-mailer-and-reminders.mjs` |
| 07.22, 07.23 | `evals/07-emails-and-invites.mjs` |
| 07.7 (one phone screen), the look in Gmail and Outlook, the invite added by itself | QA report |

## Not in this spec

When an email is queued (specs 04 to 06). Sending, retries and reminders (spec 08). The three
"book your call" emails, which are not changed.
