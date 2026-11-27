# Spec 09 · The company's screens in the portal

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 1 to 5, 8 to 11, 13 to 19 · **Status:** Draft

## What this covers

The sidebar card, the booking calendar, the booked screen, the booked-call dialog, and the way in
from an email, on the v2 portal. The functions behind them are spec 04.

## Behaviour

**The card** (`components/onboarding/onboarding-call-sidebar.tsx`)

- 09.1 The card shows for an owner (spec 04.1) when the call state is `offer`, `booked` or `waiting`, and never for anyone else.
- 09.2 `offer`: Bryan's photo, `Free onboarding call`, `With Bryan · 30 minutes`. A click opens the calendar.
- 09.3 `booked`: `Onboarding call booked` and the short time with its zone (spec 03.7). A click opens the booked-call dialog.
- 09.4 `waiting`: `Waiting for Bryan to confirm`, and under it the time it was for. A click opens the booked-call dialog in its waiting form (09.14).
- 09.5 On the collapsed rail the card is Bryan's photo with the same words in a tooltip.

**The calendar** (`components/onboarding/onboarding-call-booking.tsx`)

- 09.6 It opens from the card, from the quick tour's `Book onboarding call`, from `?book-call=1`, and from the booked-call dialog's `Move the call`.
- 09.7 It shows the free times that spec 04.7 returns. It does not work them out itself.
- 09.8 Above the month: `Times are in <zone label>` and a `change` link. `change` opens a searchable list of zones; picking one redraws the month and the times, and is remembered on the device (spec 03.4).
- 09.9 The day's list is headed with the day and the zone (spec 03.7).
- 09.10 No free times this month: `No free times in <month>. Try the next month.` with the next-month button. No free times at all: `Bryan has no free times in the next <n> days. Please check back soon.`
- 09.11 Bryan not taking calls: `Bryan is not taking new calls right now. Please check back soon.` and no month.
- 09.12 It could not load: `The calendar could not be loaded.` and `Try again`.
- 09.13 A refused booking shows the server's message (spec 02) above the button with `Pick another time`, and reads the free times again.

**After booking, and the booked-call dialog**

- 09.14 The booked screen shows the full time with its zone, the call link (or `Bryan will send you the call link by email before the call.` when none is set), and Add to calendar: Google, Outlook, Apple or other (spec 07.24).
- 09.15 The booked-call dialog shows the same time and the call link, the checklist (add a vehicle, upload a logo, preview the website), `Move the call` and `Cancel it`. In the waiting form it says `Your call was for <time>. Bryan will mark it shortly.` and offers `Book a new time` instead of move and cancel.
- 09.16 `Cancel it` asks once, inline: `Cancel your call with Bryan?`, with an optional `Reason (optional)` box, `Keep it` and `Cancel the call`. No browser pop-up.
- 09.17 After a cancel the dialog closes, a toast says `Your call is cancelled`, and the card shows `offer`.
- 09.18 After book, move or cancel the portal calls the mailer to send what was queued, and does not wait for it.

**From an email**

- 09.19 `/?call=open` opens the booked-call dialog when a call is booked or waiting, and the calendar when not. The flag is removed from the address so a refresh does not reopen it.
- 09.20 Signed out, the sign-in keeps the whole address (path and query), so after signing in the owner lands on 09.19.

**On a phone**

- 09.21 At 360 and 430 pixels wide, in light and dark, every step fits with no sideways scroll, and the keyboard never hides the Book button.

## Worked examples

None.

## Database

None.

## Functions

Spec 04's, through `hooks/use-onboarding-call-calendar.ts` and `hooks/use-onboarding-call.ts`.
`lib/onboarding-call-slots.ts` keeps only the Add to calendar links; its `buildSlots` is removed.

## Screens

As above, in `apps/portal`.

## Money and safety

None.

## Proof

| Statement | Proved by |
|---|---|
| 09.7 | `evals/04-company-actions.mjs` (the times come from the server) and the QA report |
| 09.1 to 09.6, 09.8 to 09.21 | QA report (what a person sees on a phone and a laptop) |

## Not in this spec

Bryan's page (spec 10). The signup call step on drive-247.com, which is not part of this feature.
