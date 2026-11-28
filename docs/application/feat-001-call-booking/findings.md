# Findings · feat-001 · the 11 suspicions

Each suspicion from the brief (section 8): was it real, what changed, and what proves it now.
"Before" is the code at `4b61a281`, the commit this work started from.

| # | Suspicion | Real? | Before | Now | Proved by |
|---|---|---|---|---|---|
| 1 | Anyone on a company's team can book, move or cancel, not only owners. | **Real** | `book_onboarding_call` and `cancel_my_onboarding_call` only checked that the login had a company. "Owners only" was decided on the screen. | The server refuses anyone who is not a head admin or admin of the company: `Only the account owner can book the onboarding call`. A switched-off admin is refused too. | 04.1, 04.6 |
| 2 | The server accepts a time such as 9:07. | **Real** | The booking only checked that the call sat inside Bryan's hours. | A time must be a window's start plus whole call lengths, or it is refused as `off_grid` (`Bryan is not available then`). | 02.7, 02.12, 04.12 |
| 3 | The card and the calendar can show different times for the same call. | **Real** | The sidebar card used the company's saved settings zone; the calendar used the device's. | Every screen uses one zone: the device's, or the one the person picked with "change", kept on the device. Emails use the zone saved with the booking. | 03 test file (both formatters give the same words), QA report |
| 4 | A past call that Bryan never marks stays "booked" for ever. | **Real** | The card said "booked" after the time had passed, and the company could only move the old call. | A live call whose time has passed shows "Waiting for Bryan to confirm". Booking a new time closes the old one as missed, quietly, and saves a new call. | 04.19, 04.20, 04.21 |
| 5 | Putting a call back to "booked" can collide with another call. | **Real** | Bryan's status change was a plain update. Only the one-per-time index could stop it, with a raw database error, and an overlap with a different start (with a gap set) got through. | Putting a cancelled call back runs the full check (taken, past, day off, hours, blocked) and refuses a company that already has another call. | 05.7 |
| 6 | A day off does nothing to calls already booked that day. | **Real** | Settings were saved straight to the table. Booked calls stayed and nobody was told. | Saving lists every booked call the change hits and saves nothing until Bryan says keep or cancel for each. A cancel emails the company. Direct updates to the settings are now refused. | 06.1, 06.7 to 06.10 |
| 7 | "Add to calendar" may do nothing on an iPhone. | **Real** | The invite was a `data:` link built in the browser, which Safari often refuses. | The invite is a real file served over https by `onboarding-call-ics`, plus Google and Outlook links. The emails carry the invite as an attachment as well. | 07 test file, 07.22, 07.23, QA report on a real iPhone |
| 8 | The two calculators can disagree. | **Real** | The browser worked out the free times itself (`buildSlots`) and the database checked them separately. | There is one calculator, in the database. The calendar only shows the list the server sends. Every listed time passes the check and every accepted time is listed, minute by minute over 31 days. | 02.14, 04.7 |
| 9 | After a cancel, the "book your call" emails may start again, or never. | **Real** (they started again) | A cancel cleared the booked state the journey emails look at, so the reminder could go out again. | A cancel or a missed call stops the three journey emails for good. *To confirm with Ghulam.* The cancelled email has its own "Book a new time" button. | 04.26 (database and Vitest) |
| 10 | The card disappears while a call is still booked. | **Real** | The offer ended on day 30 or at the end of the trial, even with a call booked. | A company holding a live call keeps the card until the call is done. | 04.2, 04.3 |
| 11 | A changed call length breaks existing bookings. | **Not real on the server** | Each booking already kept its own stored end, so a change from 30 to 45 minutes did not move or break it. Nothing showed Bryan this, though. | Proved and kept: booked calls keep their 30 minutes, are not listed as clashes, and new 45 minute times are worked out around their real end. | 02.16, 06.13 |

## Found while proving the specs

- Spec 02.16 said a 45 minute call gives 11 times a day. It gives 10 (480 minutes ÷ 45, and 16:30 would end at 17:15). The spec was wrong, the code was right.
- Spec 06.7 said a longer call length is a clash. That contradicted 06.13. A booked call keeps its own end, so a longer length is never a clash. The spec was fixed.
- Putting a cancelled call back only checked "taken" at first. It now runs the full check (05.7).
- The Today card counted only live calls while the Today list showed done and missed ones too. Both now count every call that is not cancelled (05.19).

## Outside this task, for Ghulam

- `onboarding-call-reminder` on staging runs older code than `main` (Ghulam's changes of 19 to 23 November to the journey emails are not deployed there). Deploying this feature's small reminder change would ship those too, so it waits for his word.
- Open rules to confirm are listed in the PRD, under "Not decided yet".

## For the relay

What production needs, in this order, after the code reaches `main`:

1. Apply `supabase/migrations/20261128100000_onboarding_call_booking_v2.sql` to production as one file. It keeps the existing booking (spec 01.20).
2. Deploy `onboarding-call-mailer`, then `onboarding-call-ics`, one at a time, each with `verify_jwt = false`. Check each: a visitor's POST to the mailer gets `401`; `onboarding-call-ics?t=nope` gets `404`.
3. `onboarding-call-reminder`: only once Ghulam has said its undeployed changes may go with it (see above).
4. Secrets on production: do **not** set `ONBOARDING_CALL_ONLY_TO`. `PORTAL_ROOT_DOMAIN` and `ADMIN_APP_URL` can stay unset (the defaults are `portal.drive-247.com` and `https://admin.drive-247.com`).
5. Create the mailer job on production, switched **on**, every 5 minutes, posting `{}` to the production `onboarding-call-mailer` with the `x-platform-secret` header, the same way the `onboarding-call-reminder` job does.

On staging (already done): the migration, both new functions, the mailer job switched off, and the secrets `ONBOARDING_CALL_ONLY_TO`, `PORTAL_ROOT_DOMAIN = portal.ray3.drive-247.com`, `ADMIN_APP_URL = https://admin.ray3.drive-247.com`.
