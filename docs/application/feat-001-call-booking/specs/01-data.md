# Spec 01 · The data

**Feature:** feat-001 · Onboarding call with Bryan, and his Call Calendar · **PRD stories:** 2, 5, 6, 21, 24, 26, 32 · **Status:** Draft

## What this covers

The tables and columns the call booking keeps, what is allowed in them, and who may read and write
them. The rules that decide a free time are in spec 02; the actions that write bookings are in
specs 04 and 05.

## Behaviour

- 01.1 There is exactly one row of Bryan's settings. A second row cannot be inserted.
- 01.2 Staging has that row, with the values in spec 02's table (30 minutes, Monday to Friday 9:00 to 17:00 `America/New_York`, 12 hours' notice, 30 days ahead, no gap, taking calls).
- 01.3 A settings time zone that is not a real IANA zone is refused with `Unknown time zone`.
- 01.4 A weekly window that ends at or before it starts is refused with `A window must end after it starts`.
- 01.5 A call length outside 10 to 180 minutes, a gap outside 0 to 120, notice outside 0 to 336 hours, or days ahead outside 1 to 180 is refused.
- 01.6 A booking stores the company's time zone (`customer_timezone`). A zone that is not a real IANA zone is refused.
- 01.7 A booking stores how it was made (`booked_via`: `portal` or `admin`).
- 01.8 A cancelled booking stores who cancelled it (`cancelled_by`: `operator`, `admin` or `system`) and the reason, if one was given (up to 500 characters).
- 01.9 A booking moved by either side keeps its id. Its `sequence` goes up by one on every move and on a cancel, so a calendar invite can be updated in place.
- 01.10 Every booking has its own unguessable `ics_token`, used for the "Add to calendar" link (spec 07).
- 01.11 Two live bookings can never share a start time.
- 01.12 A company can never hold two live bookings.
- 01.13 Every action on a booking writes one history row: booked, moved, cancelled, completed, missed, reopened. It says who did it (`operator`, `admin`, `system`), the user if there was one, the old and new start for a move, the reason for a cancel, and when.
- 01.14 A blocked period (spec 06) is stored as a fixed start and end with an optional label up to 80 characters. One that ends at or before it starts is refused.
- 01.15 Every email the feature sends has one row in the email ledger with a unique key. A second row with the same key cannot be inserted, so the same email is never queued twice.
- 01.16 A company member can read none of these tables directly: not bookings, history, blocks, the email ledger, nor the settings. They see only what the portal functions return (spec 04).
- 01.17 A super admin can read bookings, history, blocks, the email ledger and the settings.
- 01.18 Nobody signed in can insert, update or delete bookings, history, blocks, the ledger or the settings directly. Every write goes through the functions in specs 04 to 08.
- 01.19 A visitor with no login can read nothing and call none of the functions.
- 01.20 The booking that exists on production before this change keeps every value it had. Its new columns are filled as: `customer_timezone` empty, `booked_via` `portal`, `sequence` 0, a new `ics_token`.
- 01.21 Bookings are in the realtime publication, so Bryan's page hears a change as it happens. Only super admins receive the rows, because the read policy applies.

## Worked examples

None.

## Database

Migration: `supabase/migrations/20261128100000_onboarding_call_booking_v2.sql`. Additive: no column
is dropped or renamed.

`onboarding_call_bookings`, new columns:

| Column | Type | Rule |
|---|---|---|
| `customer_timezone` | text | null, or a name in `pg_timezone_names` (trigger) |
| `booked_via` | text not null default `'portal'` | check in (`portal`, `admin`) |
| `cancel_reason` | text | check length <= 500 |
| `sequence` | integer not null default 0 | check >= 0 |
| `ics_token` | uuid not null default `gen_random_uuid()` | unique |
| `rescheduled_at` | timestamptz | when it was last booked or moved, used by spec 08 |

`cancelled_by` check widened to (`operator`, `admin`, `system`).

New `onboarding_call_history`: `id uuid pk`, `booking_id uuid not null fk cascade`, `tenant_id uuid not null fk cascade`,
`kind onboarding_call_event_kind not null` (enum `booked, moved, cancelled, completed, missed, reopened`),
`actor text not null check in (operator, admin, system)`, `actor_user_id uuid fk app_users set null`,
`from_starts_at timestamptz`, `to_starts_at timestamptz`, `reason text check <= 500`, `created_at timestamptz not null default now()`.
Index on `(booking_id, created_at)`.

New `onboarding_call_blocks`: `id uuid pk`, `starts_at timestamptz not null`, `ends_at timestamptz not null`,
`label text check <= 80`, `created_at`, check `ends_at > starts_at`.

New `onboarding_call_emails` (the ledger): `id uuid pk`, `booking_id uuid not null fk cascade`,
`kind onboarding_call_email_kind not null` (enum `booked_company, booked_host, moved_company, moved_host,
cancelled_company, cancelled_host, reminder_day, reminder_hour, missed`), `recipient text not null`,
`dedupe_key text not null unique`, `payload jsonb not null default '{}'`, `status text not null default 'pending'`
check in (`pending, sending, sent, failed, skipped`), `attempts int not null default 0`, `error text`,
`sent_at timestamptz`, `created_at timestamptz not null default now()`. Index on `(status, created_at)`.

RLS on all four new tables. Policies: `select` for `is_super_admin()` only. Grants: `select` to
`authenticated`, nothing to `anon`, all to `service_role`. On `onboarding_call_settings` the direct
`update` grant to `authenticated` is revoked: settings change only through spec 06's function.

`alter publication supabase_realtime add table onboarding_call_bookings`.

## Functions

None in this spec. The functions that write these tables are in specs 02 to 08.

## Screens

None.

## Money and safety

No money. Private data: a person's name, email, phone and note. Only super admins and the company
itself (through spec 04's functions, which return its own booking only) can see them. The ledger
holds recipients and is super-admin only.

## Proof

| Statement | Proved by |
|---|---|
| 01.1 to 01.21 | `evals/01-data.mjs` |

## Not in this spec

The slot rules (spec 02). What a function returns to the portal (spec 04).
