# Spec 05 · Bryan's actions on a booking

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 15, 16, 24, 25, 26, 27, 28, 29 · **Status:** Draft

## What this covers

What a super admin can do to one booking: mark it done or missed, put it back, cancel it, move it,
and book one for a company. And the list, the counts and one booking's details as Bryan's page reads
them. The page itself is spec 10.

## Behaviour

**Who**

- 05.1 Every function here refuses anyone who is not a super admin with `Super admin access required` (`42501`), including company owners.

**Done and missed**

- 05.2 Marking a booking `completed` sets it done, writes a `completed` history row by `admin`, and sets the company's call as completed, so its card goes away.
- 05.3 Marking a booking `missed` sets it missed, writes a `missed` history row, queues the `missed` email to the company, and puts the company's card back on offer.
- 05.4 Only a booking whose start has passed can be marked done or missed: otherwise `This call has not happened yet.`
- 05.5 Marking missed twice queues the `missed` email once.

**Putting it back**

- 05.6 A done or missed booking can be put back to `booked`. It writes a `reopened` history row and puts the company's call state back to booked (and clears completed).
- 05.7 A cancelled booking can be put back to `booked` only if its time passes spec 02's check without notice, ignoring itself, and the company holds no other live booking. Otherwise `taken` or `That company already has another call booked.`
- 05.8 Bryan's own note can be saved on any booking without changing its state.

**Cancel**

- 05.9 Cancel needs a reason of 1 to 500 characters: without one, `Please give a reason.` *(To confirm.)*
- 05.10 Cancel sets `cancelled`, `cancelled_by = admin`, the reason, `sequence` up by one, frees the time, writes a `cancelled` history row, queues `cancelled_company` and `cancelled_host`, and puts the company's card back on offer.
- 05.11 Cancelling a booking that is not live is refused with `This call is not booked.`

**Move**

- 05.12 Bryan moves a live booking to a new time that passes spec 02's check without notice, ignoring the booking itself. A time 2 hours away is accepted from Bryan and refused from a company.
- 05.13 A move keeps the booking's id, sets the new start and end, raises `sequence`, writes a `moved` history row by `admin` with both times, and queues `moved_company` and `moved_host`.
- 05.14 A move to a time that has passed is refused (`past`).

**Book for a company**

- 05.15 Bryan books for any company, offered the call or not, with a time, a name, an email, an optional phone and note, and the company's zone (default: the company's own settings zone, else Bryan's).
- 05.16 It is checked without notice, saved with `booked_via = admin`, writes a `booked` history row by `admin`, and queues `booked_company` and `booked_host`.
- 05.17 It is refused with `That company already has another call booked.` when the company holds a live booking.
- 05.18 The company's portal card shows the call as booked (spec 04.27), as if they had booked it.

**The list, the counts and the details**

- 05.19 The counts are, in Bryan's zone: calls today that are not cancelled (the same calls the Today view lists), live calls this week (Monday to Sunday), calls waiting to be marked (live, start passed), and missed calls whose time was in this calendar month.
- 05.20 The list takes a view: `upcoming` (live, start in the future, soonest first; the default), `today`, `needs_marking` (live, start passed, oldest first), `done`, `missed`, `cancelled`, `all` (the last four newest first).
- 05.21 The list takes a date range, read as whole days in Bryan's zone, inclusive.
- 05.22 The list takes a search, matched without case against the company name, the person's name, the email and the phone.
- 05.23 The list returns at most the page size asked (25 by default, 100 at most) and the total count, so 500 bookings arrive 25 at a time.
- 05.24 Each row carries the company's name and slug, the person, the start and end, Bryan's zone, the company's saved zone, the state (`waiting` for a live booking whose start passed), and who cancelled it.
- 05.25 The details carry everything in 05.24 plus the email, phone, note, Bryan's note, the call link, and the history rows in order.

## Worked examples

None.

## Database

In the migration of spec 01. `admin_set_onboarding_call_booking` is replaced (same name).

## Functions

| Function | In | Out | Errors |
|---|---|---|---|
| `admin_set_onboarding_call_booking(p_id, p_status, p_admin_notes)` | id, `completed`, `missed` or `booked`, note | none | 05.1, 05.4, 05.7, `No such booking` |
| `admin_note_onboarding_call(p_id, p_admin_notes)` | id, note | none | 05.1 |
| `admin_cancel_onboarding_call(p_id, p_reason)` | id, reason | none | 05.1, 05.9, 05.11 |
| `admin_move_onboarding_call(p_id, p_starts_at)` | id, time | `{ starts_at, ends_at }` | 05.1, spec 02 |
| `admin_book_onboarding_call(p_tenant_id, p_starts_at, p_name, p_email, p_phone, p_notes, p_timezone)` | as named | `{ id }` | 05.1, 05.17, 04.11, spec 02 |
| `admin_onboarding_call_counts(p_now default now())` | none | `{ today, week, needs_marking, missed_month }` | 05.1 |
| `admin_list_onboarding_calls(p_view, p_from, p_to, p_search, p_limit, p_offset)` | as named | `{ rows, total }` | 05.1, `Unknown view` |
| `admin_onboarding_call_detail(p_id)` | id | 05.25 | 05.1, `No such booking` |
| `admin_onboarding_call_free_slots(p_exclude uuid default null)` | booking to ignore | instants | 05.1 |

## Screens

Spec 10.

## Money and safety

No money. Only super admins reach any of these, which is checked inside each function.

## Proof

| Statement | Proved by |
|---|---|
| 05.1 to 05.17, 05.19 to 05.25 | `evals/05-bryan-actions.mjs` |
| 05.18 | `evals/05-bryan-actions.mjs` (the company's `get_my_onboarding_call` after Bryan books) and the QA report |

## Not in this spec

Bryan's settings (spec 06). The emails (spec 07).
