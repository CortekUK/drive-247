# Spec 01 · Signup in three steps

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 1, 2, 4, 5, 6 · **Status:** Draft

## What this covers

The signup on drive-247.com after the change: about you → business → card, with no email code
and no password screen. How the account is created and signed in without a chosen password, and
how a signup that is left and resumed finds its place. It stops at the card being accepted;
landing in the portal is spec 02.

## Behaviour

- 01.1 The signup steps, in order, are `account` (about you), the business screen (`account` in
  `tenant` mode), and `payment` (card). Neither the `verify` step nor the `password` account mode
  is ever shown during signup.
- 01.2 `signup-begin` creates the user with a stand-in password made by `makeStandInPassword()`.
  The person never sees or types it. Supabase is told the email is confirmed (it gives no session
  otherwise); whether the person has really proved the address is `d247_signup_email_pending`
  (01.4), and that flag is the only thing any app reads for it.
- 01.3 `signup-begin` returns a session for the new user (an access and a refresh token) so the
  browser is signed in without the email being confirmed. The business and card steps use that
  session as today.
- 01.4 The new user is marked `d247_signup_password_pending: true` and
  `d247_signup_email_pending: true` in `app_metadata` (server-set, not editable by the person).
- 01.5 The six-digit email code is sent by `signup-begin` when the account is created, so it is
  waiting in the inbox when the portal asks for it (spec 03).
- 01.6 A Google signup (`signup-begin-oauth`) sets neither pending flag; its email is already
  confirmed by Google.
- 01.7 Each step keeps what was typed when the person goes back and forward.
- 01.8 Resuming a signup in the same browser returns to the step it was left on with its fields
  filled. A resume never asks for a password before the card (the old `passwordStillPending()`
  detour is removed).
- 01.9 The "finish later" email link (7 days) signs the person in and returns them to their step.
- 01.10 An email that already has an account is refused at the about-you step with
  `EMAIL_IN_SIGNUP`-style "You already have a portal" and a sign-in option; no second user is made.
- 01.11 A declined card or failed 3D Secure check keeps the person on the card step with the
  reason; no company is set up until a card is accepted.
- 01.12 The leave-offer shows at most once per signup.
- 01.13 The stand-in is never written to localStorage, logged, or sent anywhere except
  `signup-begin`. It is forgotten when the signup finishes or the tab closes.

## Worked examples

None.

## Database

None. The pending flags live in `auth.users.raw_app_meta_data`.

## Functions

- `signup-begin` (JWT not required, as today): now always creates `email_confirm: true` with the
  pending flags, returns
  `{ session: { access_token, refresh_token }, requiresVerification: false }`, and sends the code.
  The `SIGNUP_OTP_ENABLED` / `admin_settings.signup_otp_enabled` switch no longer decides whether a
  code step is shown; it is removed.
- `signup-verify-otp`: unchanged contract; now called from the portal (spec 03).
- `signup-payment-intent-v2`, `signup-provision`, `signup-resume`, `signup-finish-later`: still
  require a Bearer session; they must accept a user whose email is not yet confirmed.

## Screens

`apps/web/src/components/onboarding/`: `onboarding-provider.tsx` (transitions; `verifyEmailCode`
and `submitPassword` leave the signup path), `onboarding-screen.tsx`, `steps/account-step.tsx`
(the `password` mode is no longer reached), `steps/verify-step.tsx` (no longer reached in signup).
The screens' design does not change.

## Money and safety

A session for an unconfirmed email is only ever handed to the browser that just created the
account. Anyone who typed someone else's email could start a signup in their name; spec 04's 3-day
block and spec 03's "wrong email" path bound how long such an account works without the code.
No card is charged during a trial (spec 08).

## Proof

| Statement | Proved by |
|---|---|
| 01.2, 01.3, 01.4, 01.5, 01.6, 01.10 | `evals/01-signup-steps.mjs` (calls the functions on staging) |
| 01.13 | `evals/01-signup-steps.mjs` (reads the source for storage writes) |
| 01.1, 01.7, 01.8, 01.9, 01.11, 01.12 | QA report (a flow through screens, on real phones) |

## Not in this spec

Landing in the portal (02). The code and password window (03). Prices and promo codes (08).
