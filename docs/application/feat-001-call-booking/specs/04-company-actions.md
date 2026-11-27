# Spec 04 · The company books, moves and cancels

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 1, 2, 4, 5, 8, 9, 10, 13, 14, 15, 16 · **Status:** Draft

## What this covers

The portal's database functions: what the calendar reads, and booking, moving and cancelling as a
company. It also covers who is offered the call and what the card's state is. The rules for a free
time are spec 02's; the emails these actions queue are spec 07's.

## Behaviour

**Who**

- 04.1 An owner is a login of the company whose role is `head_admin` or `admin`. *(To confirm with Ghulam.)*
- 04.2 A company is offered the call if it is on the v2 portal and in its first 30 days or trialing, or it is Northwind.
- 04.3 A company that holds a live booking keeps the call on offer even after its 30 days or its trial end, so a call booked on day 29 does not vanish. *(To confirm.)*
- 04.4 A login with no company gets `There is no company on this login to book for` from book, move and cancel.
- 04.5 A login whose company is not offered the call gets `The onboarding call is not available for this account`.
- 04.6 A team member who is not an owner gets `Only the account owner can book the onboarding call` from book, move and cancel. This is checked on the server.

**Reading the calendar**

- 04.7 The calendar returns Bryan's name, title, photo, call length, zone, whether he is taking calls, the free times from spec 02 as instants, and the company's own live booking.
- 04.8 It never returns another company's name, email, phone, note, or the time of its booking apart from its absence from the free times.
- 04.9 The call link is returned only once the company holds a live booking.

**Book**

- 04.10 A good booking is saved with the name trimmed, the email trimmed and lower-cased, the phone and the note trimmed (empty becomes none), the time zone, `booked_via = portal`, and `rescheduled_at = now`.
- 04.11 A name of 1 to 120 characters, an email with an `@` up to 254 characters, a phone up to 40 and a note up to 1000 are accepted; anything else is refused with `Please check your details`.
- 04.12 Every rule of spec 02 is applied with notice.
- 04.13 A booking writes a `booked` history row by `operator` and queues the `booked_company` and `booked_host` emails.
- 04.14 Booking sets the company's call state: booked, scheduled for the new time, cancelled and missed cleared.

**Move**

- 04.15 Booking while the company holds a live booking in the future moves it: the same row gets the new start and end, `sequence` goes up by one, `rescheduled_at = now`, and the old time is free.
- 04.16 A move must give the 12 hours' notice for the new time (spec 02.3). It may be made at any moment before the call starts. *(To confirm.)*
- 04.17 A move writes a `moved` history row with the old and the new start, and queues `moved_company` and `moved_host`.
- 04.18 After a move the company still holds exactly one live booking.

**A call whose time has passed**

- 04.19 A live booking whose start is at or before now is `waiting` (for Bryan to mark it), not `booked`.
- 04.20 Booking while the company's live booking is `waiting` closes the old one as `missed` by `system` (no email) and saves a new booking. *(To confirm.)*
- 04.21 A company cannot cancel a `waiting` call: `This call has already started.`

**Cancel**

- 04.22 Cancel takes an optional reason up to 500 characters. It sets the booking `cancelled`, `cancelled_by = operator`, the reason, `sequence` up by one, and frees the time.
- 04.23 Cancel writes a `cancelled` history row and queues `cancelled_company` and `cancelled_host`.
- 04.24 After a cancel the card offers the call again.
- 04.25 Cancel with no live booking does nothing and returns no error.
- 04.26 A cancelled call leaves the three "book your call" emails stopped. *(To confirm.)*

**The card's state** (`get_my_onboarding_call`)

- 04.27 It returns `call_state`: `offer`, `booked`, `waiting`, or `none`. `none` when the call is done, hidden or not on offer.
- 04.28 With `booked` or `waiting` it returns the booking's id, start, end, saved zone and (if set) the call link.
- 04.29 Marking done (spec 05) makes it `none` for good.
- 04.30 Marking missed makes it `offer` again.

## Worked examples

None.

## Database

In the migration of spec 01: `book_onboarding_call` and `cancel_my_onboarding_call` are replaced
(same names, new parameters), `get_onboarding_call_calendar` and `get_my_onboarding_call` return
the new fields, and `onboarding_call_eligible` stays. New helper `onboarding_call_is_owner()`.

## Functions

| Function | Who | In | Out | Errors |
|---|---|---|---|---|
| `get_onboarding_call_calendar()` | signed in | none | 04.7 | `42501` with no company and not a super admin |
| `book_onboarding_call(p_starts_at, p_name, p_email, p_phone, p_notes, p_timezone)` | owner | 04.10 | `{ id, starts_at, ends_at, meeting_url, moved }` | 04.4 to 04.6, 04.11, every refusal of spec 02 |
| `cancel_my_onboarding_call(p_reason text default null)` | owner | reason | none | 04.4, 04.6, 04.21 |
| `get_my_onboarding_call()` | signed in | none | the card's state, 04.27 and 04.28 | none (null without a company) |

All are `security definer`, `set search_path = public`, `revoke` from `public, anon`, `grant execute`
to `authenticated`. After a successful book, move or cancel the portal asks spec 08's mailer to
send what was queued.

## Screens

Spec 09.

## Money and safety

No money. Each function finds the company from the login (`get_user_tenant_id()`), never from an
argument, so no company can act on another's booking.

## Proof

| Statement | Proved by |
|---|---|
| 04.1 to 04.30 | `evals/04-company-actions.mjs` |

## Not in this spec

Bryan's actions (spec 05). The emails' contents (spec 07). The screens (spec 09).
