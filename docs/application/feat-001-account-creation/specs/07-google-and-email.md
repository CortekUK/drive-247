# Spec 07 · Connecting and disconnecting Google

**Feature:** feat-001 · Account creation and the account · **PRD stories:** 18 – 23 · **Status:** Draft

## What this covers

New: a "Sign-in methods" part of the profile panel that shows how a person can sign in and lets
them add or remove Google and a password.

## Behaviour

- 07.1 The profile shows the sign-in methods the account has: "Email and password" and/or
  "Google (<google email>)".
- 07.2 A person who signed up with Google can set a password from the profile (the 06.8 flow).
  Afterwards both ways sign in.
- 07.3 "Connect Google" links a Google account whose email is the same as the account's email
  (compared lowercase, trimmed). Afterwards both ways sign in.
- 07.4 A Google account with a different email is refused: "This Google account uses a different
  email from your Drive247 account." Nothing is linked.
- 07.5 A Google account that is already linked to another Drive247 user is refused.
- 07.6 "Disconnect Google" is refused while the account has no password, with "Set a password
  first."
- 07.7 With a password set, "Disconnect Google" removes the link; Google no longer signs in.
- 07.8 An account is never left with no way to sign in (07.6 is the only case that can arise).
- 07.9 Changing the email (06.5) while Google is linked removes the Google link once the new email
  is confirmed, and says so. If there is no password, the email change is refused with "Set a
  password first."
- 07.10 Connect and Disconnect are hidden inside the Instagram and Facebook apps, where Google
  sign-in does not work.

## Worked examples

None.

## Database

None. Links are `auth.identities` rows.

## Functions

- `auth.linkIdentity({ provider: "google" })` in the browser (needs "manual linking" on in
  Supabase Auth for staging, then production at the relay).
- New `account-identity-check` (JWT required): after the Google redirect, compares the linked
  identity's email with the account email; on a mismatch it unlinks it at once and returns
  `GOOGLE_EMAIL_MISMATCH`. Also `unlink` with the 07.6 check. Errors: `GOOGLE_EMAIL_MISMATCH`,
  `IDENTITY_IN_USE`, `NO_PASSWORD`, `NOT_LINKED`. Also `status` (07.1) and `password_set` (07.2).
- "Has a password" = an `email` identity, or the `d247_password_set` marker the profile sets, and
  never while `d247_signup_password_pending` is on. Supabase stores a random hash even for an
  account made without a password, so `encrypted_password` proves nothing.

## Screens

Portal `components/shared/layout/profile-sheet-v2.tsx`, a new "Sign-in methods" section.

## Money and safety

The email-must-match rule is what stops two people sharing one account. The check runs on the
server (07.4 is enforced after linking, not only in the browser).

## Proof

| Statement | Proved by |
|---|---|
| 07.4, 07.5, 07.6, 07.7, 07.8, 07.9 | `evals/07-google-and-email.mjs` (uses the admin API to make identities on test users) |
| 07.1, 07.2, 07.3, 07.10 | QA report (Google's own sign-in page) |

## Not in this spec

Google signup itself (01).
