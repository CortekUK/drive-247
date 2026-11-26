# Spec 03 · The verify and password window in the portal

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 7, 8, 9, 10 · **Status:** Draft

## What this covers

The one window a new operator sees in the portal to enter their email code and then choose a
password. It stops at the password being saved; when the window appears and the 3-day block are
spec 04.

## Behaviour

- 03.1 The window shows only for a signed-in person whose `d247_signup_email_pending` or
  `d247_signup_password_pending` is true.
- 03.2 It has two parts in order: the code, then the password. Someone whose email is confirmed
  but who has no password yet starts at the password part.
- 03.3 The code is 6 digits. The field opens the number keyboard, accepts a pasted code, and offers
  the phone's one-time-code autofill (`autocomplete="one-time-code"`).
- 03.4 The right code clears `d247_signup_email_pending` and records `emailVerifiedAt` in
  `app_metadata.d247_signup`.
- 03.5 A wrong code is refused with `OTP_INVALID` and the tries left. The 5th wrong code locks the
  code (`OTP_LOCKED`); only a new code works after that.
- 03.6 A code older than 30 minutes is refused as expired.
- 03.7 "Send a new code" sends one and makes every older code stop working. It is refused for 60
  seconds after the last send, and the button shows the seconds left.
- 03.8 "Wrong email?" lets the person type a corrected address. It is refused if that address
  already belongs to another account, or is not a valid email. Otherwise the account's email is
  changed, a new code goes to the new address, and the old address gets nothing more.
- 03.9 The email can only be corrected this way while `d247_signup_email_pending` is true.
- 03.10 The password must be at least 8 characters with a letter and a number. A password that
  breaks the rule is refused with the rule shown.
- 03.11 Saving the password clears `d247_signup_password_pending`. The stand-in password stops
  working at that moment.
- 03.12 After saving, the phone or browser is offered the password to save
  (`autocomplete="new-password"` with the email as `username`).
- 03.13 The password part reuses `PasswordChangePanelV2`; there is no second password form.
- 03.14 Buttons show they are working and cannot be pressed twice while a request is running.

## Worked examples

None.

## Database

None. Codes stay where `_shared/signup-otp.ts` keeps them (hashed, in the user's metadata).

## Functions

- New `signup-verify-email` (`verify_jwt = true`, and it calls `auth.getUser()`; acts on the
  caller's own account only, never by email): actions `verify { code }`, `resend`, and
  `change_email { newEmail }`. Errors: `UNAUTHORIZED` (401), `OTP_INVALID` (+ `attemptsRemaining`),
  `OTP_LOCKED` (429), `OTP_EXPIRED`, `RESEND_COOLDOWN` (429, + `retryAfterSeconds`), `EMAIL_TAKEN`,
  `EMAIL_INVALID`, `EMAIL_SAME`, `ALREADY_CONFIRMED`. `verify` on a proved email answers
  `alreadyVerified`.
- New `signup-set-password` (`verify_jwt = true`): `{ password }`; checks the rule, sets it, clears
  the flag. Errors: `UNAUTHORIZED` (401), `PASSWORD_RULE`, `EMAIL_NOT_CONFIRMED` (a password is only
  set after the code), `NOT_PENDING` (a password already exists: the profile changes it).
- The rules both use are `_shared/signup-account-rules.ts` (the flag names, the password rule, the
  email check), pure and shared.
- *(Changed from the first draft)* `signup-verify-otp` is left as it is: today's 5-step signup
  still calls it by email without a session, so changing it before step 4 would break signups on
  staging. It is retired with the old steps.

## Screens

Portal: a new `components/onboarding/verify-account-dialog-v2.tsx`, mounted in
`app/(dashboard)/layout.tsx`. It reuses `shared/layout/password-change-panel-v2.tsx`. It fits a
360-wide phone with the keyboard open and its buttons are at least 44px tall.

## Money and safety

The code proves the person owns the email. Codes are hashed and limited to 5 tries and 30
minutes. Changing the email needs the signed-in session and is only allowed before confirmation,
so it cannot be used to take over a confirmed account.

## Proof

| Statement | Proved by |
|---|---|
| 03.1, 03.2, 03.4 – 03.11 | `evals/03-verify-and-password-window.mjs` (staging, once deployed) and, before that, `supabase/functions/_tests/signup-verify-window_test.ts` (the real functions in Deno, no network) |
| 03.13 | `evals/03-verify-and-password-window.mjs` (reads the source) |
| 03.3, 03.12, 03.14 | QA report (keyboard, autofill and password managers are on the phone) |

## Not in this spec

When the window appears and the 3-day block (04). Signing in with no password (05).
