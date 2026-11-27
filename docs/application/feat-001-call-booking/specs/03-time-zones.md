# Spec 03 · Time zones

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 2, 3, 5, 6, 7, 8, 21, 35 · **Status:** Draft

## What this covers

How one call, stored once, is written for each person in their own zone: on the portal, on Bryan's
page, in the emails and in the invite. The free times themselves come from spec 02.

## Behaviour

- 03.1 A call is stored once, as one instant in UTC (`starts_at`, `ends_at`).
- 03.2 Bryan's hours, days off and grid are read in his settings zone (`America/New_York` today).
- 03.3 The portal shows times in the device's zone (`Intl…resolvedOptions().timeZone`). If the device gives none, it uses `UTC`.
- 03.4 The person can pick another zone with "change". The choice is kept on that device and used by the calendar, the booked screen and the sidebar card alike.
- 03.5 The zone a booking was made in is saved with it (`customer_timezone`, spec 01) and is the zone the company's emails are written in. A booking with no saved zone is written in Bryan's zone in the company's emails.
- 03.6 A zone is named as its city: `Asia/Karachi` is "Karachi time", `America/Los_Angeles` is "Los Angeles time", `UTC` is "UTC". A name the formatter does not know is shown as given.
- 03.7 A time is never shown without its zone. The full form is `Wednesday, 10 March at 7:00 PM, Karachi time`; the short form is `Wed 10 Mar, 7:00 PM Karachi time`. In the list of a day's free times, the heading names the zone once (`Tue 8 Dec · Karachi time`) and the buttons show the time.
- 03.8 The same call reads the same time for the same person everywhere: the calendar, the booked screen, the sidebar card, the email and the invite. The card no longer uses the company's saved settings zone (it used to, so it could disagree with the calendar).
- 03.9 The day a free time falls on is the person's own day. A company in Karachi looking at its Tuesday sees Bryan's Monday afternoon and his Tuesday morning.
- 03.10 When the clocks change in one place, a booked call keeps its instant. It is written in the new local time for whoever's clock changed, and in the same local time for whoever's did not.
- 03.11 Bryan changing his settings zone moves no booked call: every booking keeps its `starts_at`.
- 03.12 The invite carries the call in UTC (`DTSTART:20261208T140000Z`), so every calendar app shows it in its own zone.

## Worked examples

Each row is worked by hand from the zone's UTC offset on that date. Vitest checks the portal
formatter and the email formatter against every row; the eval checks the database's own conversion
of Bryan's local time to UTC for the same rows.

Bryan's 9:00 AM New York on Tuesday 8 December 2026. New York is UTC-5 in winter, so 14:00 UTC.

| Zone | Offset | Working | Expected |
|---|---|---|---|
| America/Los_Angeles | UTC-8 | 14:00 − 8 | 6:00 AM, Tue 8 Dec |
| Pacific/Honolulu | UTC-10 | 14:00 − 10 | 4:00 AM, Tue 8 Dec |
| Europe/London | UTC+0 | 14:00 + 0 | 2:00 PM, Tue 8 Dec |
| Asia/Dubai | UTC+4 | 14:00 + 4 | 6:00 PM, Tue 8 Dec |
| Asia/Karachi | UTC+5 | 14:00 + 5 | 7:00 PM, Tue 8 Dec |
| Australia/Sydney | UTC+11 (summer) | 14:00 + 11 = 25:00 | 1:00 AM, **Wed 9 Dec** |

Bryan's last slot, 4:30 PM New York on Monday 7 December 2026 = 21:30 UTC.

| Zone | Working | Expected |
|---|---|---|
| Asia/Karachi | 21:30 + 5 = 26:30 | 2:30 AM, **Tue 8 Dec** |
| Australia/Sydney | 21:30 + 11 = 32:30 | 8:30 AM, **Tue 8 Dec** |

The clock changes of 2027. New York moves forward on 14 March (UTC-5 to UTC-4), London on 28 March
(UTC+0 to UTC+1). Karachi stays UTC+5.

| Bryan's 9:00 AM on | UTC | London | Karachi |
|---|---|---|---|
| Wed 10 Mar 2027 | 9 + 5 = 14:00 | 14 + 0 = 2:00 PM | 14 + 5 = 7:00 PM |
| Wed 17 Mar 2027 | 9 + 4 = 13:00 | 13 + 0 = 1:00 PM | 13 + 5 = 6:00 PM |
| Wed 31 Mar 2027 | 9 + 4 = 13:00 | 13 + 1 = 2:00 PM | 13 + 5 = 6:00 PM |
| Wed 10 Nov 2027 | NY back to UTC-5 on 7 Nov: 14:00 | 2:00 PM | 7:00 PM |

A company that booked 9:00 AM New York on 17 March 2027 while it was still February sees 1:00 PM
London on that day, not 2:00 PM.

## Database

None new. The conversion of Bryan's local times to instants is in spec 02's functions.

## Functions

- `apps/portal/src/lib/onboarding-call-time.ts`: `zoneLabel(tz)`, `formatCallFull(at, tz)`, `formatCallShort(at, tz)`, `formatSlotTime(at, tz)`, `dayKey(at, tz)`, `getChosenZone()`, `setChosenZone(tz)`. Pure except the two that read and write the device's saved choice.
- `supabase/functions/_shared/onboarding-call-time.ts`: the same `zoneLabel`, `formatCallFull`, `formatCallShort` for the emails. Both are written on `Intl.DateTimeFormat`; Vitest runs the same table on both so they cannot drift.

## Screens

The zone line and "change" on the calendar, the booked screen and the card: spec 09.

## Money and safety

None.

## Proof

| Statement | Proved by |
|---|---|
| 03.1, 03.2, 03.11 | `evals/03-time-zones.mjs` |
| 03.5, 03.6, 03.7 (wording), 03.9, 03.10, 03.12 | `evals/03-time-zones.test.ts` (every row of the tables, both formatters) and `evals/03-time-zones.mjs` (database rows) |
| 03.3, 03.4, 03.8 | QA report (needs a real device and its zone setting) |

## Not in this spec

Which times are free (spec 02). What each email says (spec 07).
