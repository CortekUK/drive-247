# Spec 04 · The reminder and the 3-day block

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 7, 11 · **Status:** Draft

## What this covers

When the window from spec 03 appears, what happens when it is closed, and the point after which
the portal waits for it.

## Behaviour

- 04.1 On the first visit the window opens straight after the quick tour ends or is skipped. If
  the tour is not shown, it opens on load.
- 04.2 Closing the window lets the person use the portal.
- 04.3 On every later visit (each new page load or sign-in) the window opens again while a pending
  flag is set.
- 04.4 The deadline is 72 hours after the account was created (`auth.users.created_at`), in UTC.
- 04.5 After the deadline the window cannot be closed, and the rest of the portal is not usable
  until both parts are done. `/settings` and `/subscription` are not exempt; only signing out is.
- 04.6 Before the deadline the window says how long is left ("2 days left").
- 04.7 A person with no pending flag (Google signups, people who finished) never sees the window.
- 04.8 The deadline is checked on the server too: after it, `signup-verify-otp` and
  `signup-set-password` are the only signup-flag functions a pending account may call, and the
  dashboard data still loads behind the window (nothing is deleted).

## Worked examples

| Account created (UTC) | Now (UTC) | Hours since | Blocked? |
|---|---|---|---|
| 26 Nov 10:00 | 29 Nov 09:59 | 71.98 | No |
| 26 Nov 10:00 | 29 Nov 10:00 | 72 | Yes |
| 28 Nov 23:30 | 1 Dec 23:30 | 72 (crosses a month end) | Yes |

## Database

None.

## Functions

None beyond spec 03.

## Screens

Portal `app/(dashboard)/layout.tsx` and `verify-account-dialog-v2.tsx`. The dialog takes
`blocking: boolean` from a shared `isSignupVerifyOverdue(createdAt, now)` in
`apps/portal/src/lib/signup-verify.ts`, the one place the 72-hour rule lives.

## Money and safety

The trial keeps running whether or not the window is done; nothing is charged or cancelled by it.

## Proof

| Statement | Proved by |
|---|---|
| 04.4 (worked examples) | `evals/04-reminder-and-block.test.ts` (Vitest) |
| 04.7 | `evals/04-reminder-and-block.test.ts` |
| 04.1, 04.2, 04.3, 04.5, 04.6, 04.8 | QA report (a flow across visits; the clock is moved on a test account) |

## Not in this spec

The quick tour itself; another person is building it. How the two are joined is settled when the
branches meet.
