# Spec 05 · Signing in with an email code

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 12, 17 · **Status:** Draft

## What this covers

The way back in for someone who has no password yet, on the portal login page, and the existing
"Forgot password?" flow beside it.

## Behaviour

- 05.1 The portal login page has "Email me a sign-in code" under the password field.
- 05.2 It sends a 6-digit code to the email, if that email has an account on this company's
  portal. The page says the same thing whether or not it does, so it does not reveal who has an
  account.
- 05.3 The right code signs the person in. If a pending flag is set, the window from spec 03
  follows.
- 05.4 Wrong, expired and resent codes follow the same rules as spec 03 (5 tries, 30 minutes for
  signup codes; Supabase's own limits for login codes, stated in the eval).
- 05.5 A code does not sign in to a different company's portal (the wrong-portal sign-out).
- 05.6 "Forgot password?" sends a code, then lets the person choose a new password; the old one
  stops working.
- 05.7 Neither path creates a new user for an unknown email (`shouldCreateUser: false`).

## Worked examples

None.

## Database

None.

## Functions

None new: `auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` and
`auth.verifyOtp({ type: "email" })`, as the profile sheet already uses.

## Screens

Portal `app/(auth)/login/page.tsx` / `LoginV2`, and `components/auth-v2/forgot-password-dialog-v2.tsx`.

## Money and safety

Login codes go only to the account's email. No user is created; no account is revealed.

## Proof

| Statement | Proved by |
|---|---|
| 05.2, 05.3, 05.6, 05.7 | `evals/05-sign-in-with-a-code.mjs` |
| 05.1, 05.4, 05.5 | QA report |

## Not in this spec

Setting the first password (03).
