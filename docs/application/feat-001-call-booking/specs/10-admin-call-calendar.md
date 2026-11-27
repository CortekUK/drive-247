# Spec 10 · Bryan's Call Calendar page in super admin

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 20 to 36 · **Status:** Draft

## What this covers

The Call Calendar page in the admin app, and the one button on the older tracker that points at it.
The functions behind it are specs 05 and 06.

## Behaviour

**The page** (`apps/admin/components/admin/call-calendar/`)

- 10.1 The page header says `Times in <Bryan's zone label>` at all times.
- 10.2 While no call link is set, a warning reads `No call link is set. Companies are told the link will follow by email.` with a button to the setting.
- 10.3 Three tabs: Bookings, Week, Availability. The tab, the view, the date range and the search are kept in the address, so a refresh keeps them.

**Bookings**

- 10.4 Four stat cards: Today, This week, Needs marking, Missed this month (spec 05.19), in the look of the other super admin pages.
- 10.5 A filter bar with Upcoming, Today, Needs marking, Done, Missed, Cancelled, All; a date range; and a search box.
- 10.6 The table shows, per row: company, person, Bryan's time, the company's time with its zone label (or `Zone unknown`), the state in coloured text, and `Cancelled by <company|Bryan|system>` for a cancelled row.
- 10.7 25 rows a page with `Load more` until the total is reached.
- 10.8 A booking, move or cancel by anyone appears in the list and the counts within a few seconds, without a reload (realtime, with a 30 second poll behind it).
- 10.9 Clicking a row opens its details in a dialog (spec 05.25), with the company linked to its page in super admin.
- 10.10 In the dialog: Done and Missed (only once the call's time has passed), Move, Cancel, Put back (for done, missed or cancelled), and Bryan's note. Cancel asks for a reason in the admin's own prompt dialog; nothing uses a browser pop-up.
- 10.11 Move opens a picker of Bryan's free times without notice (spec 05.12), shown in his zone with the company's time beside each.
- 10.12 `Book for a company` opens a dialog: search a company, pick a free time, the person's name, email, phone, note and the company's zone.

**Week**

- 10.13 A week from Monday to Sunday in Bryan's zone: his hours shaded, days off and blocked periods marked, and each live booking at its time with the company's name. Clicking a booking opens 10.9.
- 10.14 Previous week, next week and Today.

**Availability**

- 10.15 Everything of spec 06.3, with blocked periods as a list of date, from, to and label rows.
- 10.16 Saving a change that clashes (spec 06.8) opens a dialog listing each clashing call (company, person, time) with Keep or Cancel and the company emailed for each, and saves only once each has a choice.
- 10.17 A save shows `Saved` and redraws the week.

**The older tracker**

- 10.18 Customer management → Onboarding calls: `Open calendar` opens `/admin/call-calendar`, not the old outside calendar.

**Look and size**

- 10.19 Flat, no shadows, dialogs (not side sheets). Used on a laptop; at 360 pixels wide nothing is cut off and the table scrolls inside itself.

## Worked examples

None.

## Database

None beyond specs 01, 05 and 06.

## Functions

Spec 05's and spec 06's, called from the page. After any action the page calls spec 08's mailer
with `{ flush: true }`.

## Screens

As above, in `apps/admin`.

## Money and safety

None. Actions that email a company (cancel, move, missed, book) ask once before they run.

## Proof

| Statement | Proved by |
|---|---|
| 10.1 to 10.19 | QA report (the functions behind them are proved in specs 05 and 06) |

## Not in this spec

The rules (spec 02) and the actions themselves (spec 05).
