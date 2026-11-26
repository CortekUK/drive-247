# Eval results · feat-001-account-creation

**FAIL** · 19/51 statements proved · 62 checks · 2026-11-26 16:15 UTC

Run on staging by `npm run eval -- feat-001`, at commit `a0281aff` on `ray2` (with uncommitted changes).
This file is written by the command. Do not edit it by hand.

| Statement | Result | Checks | Eval |
|---|---|---|---|
| 00.0 | FAIL | 1 | `04-reminder-and-block.test.ts` |
| 01.2 | FAIL | 1 | `01-signup-steps.mjs` |
| 01.3 | FAIL | 1 | `01-signup-steps.mjs` |
| 01.4 | FAIL | 1 | `01-signup-steps.mjs` |
| 01.5 | pass | 1 | `01-signup-steps.mjs` |
| 01.6 | pass | 1 | `01-signup-steps.mjs` |
| 01.10 | pass | 1 | `01-signup-steps.mjs` |
| 01.13 | pass | 1 | `01-signup-steps.mjs` |
| 02.1 | FAIL | 1 | `02-landing-in-the-portal.mjs` |
| 02.3 | pass | 1 | `02-landing-in-the-portal.mjs` |
| 03.1 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.2 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.4 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.5 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.6 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.7 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.8 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.9 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.10 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.11 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 03.13 | FAIL | 1 | `03-verify-and-password-window.mjs` |
| 05.2 | FAIL | 1 | `05-sign-in-with-a-code.mjs` |
| 05.3 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 05.6 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 05.7 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 06.3 | pass | 1 | `06-profile.mjs` |
| 06.5 | pass | 1 | `06-profile.mjs` |
| 06.6 | pass | 1 | `06-profile.mjs` |
| 06.7 | pass | 1 | `06-profile.mjs` |
| 06.8 | pass | 1 | `06-profile.mjs` |
| 06.9 | pass | 1 | `06-profile.mjs` |
| 06.10 | FAIL | 1 | `06-profile.mjs` |
| 07.4 | FAIL | 1 | `07-google-and-email.mjs` |
| 07.5 | FAIL | 1 | `07-google-and-email.mjs` |
| 07.6 | FAIL | 1 | `07-google-and-email.mjs` |
| 07.7 | FAIL | 1 | `07-google-and-email.mjs` |
| 07.8 | FAIL | 1 | `07-google-and-email.mjs` |
| 07.9 | FAIL | 1 | `07-google-and-email.mjs` |
| 08.1 | FAIL | 1 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.2 | pass | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.3 | pass | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.5 | FAIL | 2 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.6 | FAIL | 9 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.7 | pass | 3 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.8 | pass | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.12 | FAIL | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.13 | FAIL | 1 | `08-prices-trials-and-promo-codes.test.ts` |
| 09.1 | FAIL | 1 | `09-signups-list.mjs` |
| 09.2 | pass | 1 | `09-signups-list.mjs` |
| 09.3 | FAIL | 1 | `09-signups-list.mjs` |
| 09.4 | FAIL | 1 | `09-signups-list.mjs` |

## What failed

- **01.2** signup-begin makes the user with a stand-in password and the email pending (`01-signup-steps.mjs`): Supabase does not treat the email as confirmed, so no session can be made
- **01.3** signup-begin returns a session for the new user (`01-signup-steps.mjs`): no access_token in the answer
- **01.4** The new user is marked email-pending and password-pending in app_metadata (`01-signup-steps.mjs`): d247_signup_email_pending: expected true, got undefined
- **02.1** signup-provision always returns a portal sign-in link (no switch) (`02-landing-in-the-portal.mjs`): signup-provision still reads SIGNUP_PORTAL_MAGICLINK
- **03.1** The window's functions refuse someone who is not signed in (`03-verify-and-password-window.mjs`): signup-verify-otp let a visitor in (400)
- **03.2** A password is only set after the code (`03-verify-and-password-window.mjs`): code: expected "EMAIL_NOT_CONFIRMED", got "NOT_FOUND"
- **03.4** The right code clears the email flag and records when (`03-verify-and-password-window.mjs`): the right code was refused: {"error":"email is required"}
- **03.5** A wrong code says how many tries are left; after 5 even the right code is refused (`03-verify-and-password-window.mjs`): a wrong code: expected "OTP_INVALID", got undefined
- **03.6** A code older than 30 minutes is refused as expired (`03-verify-and-password-window.mjs`): code: expected "OTP_EXPIRED", got undefined
- **03.7** A new code is refused within 60 seconds of the last one (`03-verify-and-password-window.mjs`): status: expected 429, got 400
- **03.8** Wrong email: a taken or invalid address is refused, a good one replaces it (`03-verify-and-password-window.mjs`): an address with an account: expected "EMAIL_TAKEN", got undefined
- **03.9** The email cannot be changed this way once it is verified (`03-verify-and-password-window.mjs`): code: expected "ALREADY_CONFIRMED", got undefined
- **03.10** A password that breaks the rule is refused (`03-verify-and-password-window.mjs`): "short1": expected "PASSWORD_RULE", got "NOT_FOUND"
- **03.11** Saving the password clears the flag and the stand-in stops working (`03-verify-and-password-window.mjs`): the password was refused: {"code":"NOT_FOUND","message":"Requested function was not found"}
- **03.13** The window reuses PasswordChangePanelV2 (`03-verify-and-password-window.mjs`): verify-account-dialog-v2.tsx is missing or does not use PasswordChangePanelV2
- **05.2** The login page asks for a code without making users, and a known email is accepted (`05-sign-in-with-a-code.mjs`): the login page has no sign-in code with shouldCreateUser: false
- **06.10** Temporary staff passwords are not made with Math.random (`06-profile.mjs`): users/page.tsx still uses Math.random
- **07.4** A Google account with a different email is refused and left unlinked (`07-google-and-email.mjs`): code: expected "GOOGLE_EMAIL_MISMATCH", got "NOT_FOUND"
- **07.5** A Google account already linked to another user is refused (`07-google-and-email.mjs`): code: expected "IDENTITY_IN_USE", got "NOT_FOUND"
- **07.6** Disconnect Google is refused while there is no password (`07-google-and-email.mjs`): code: expected "NO_PASSWORD", got "NOT_FOUND"
- **07.7** With a password, Disconnect Google removes the link (`07-google-and-email.mjs`): unlink refused: {"code":"NOT_FOUND","message":"Requested function was not found"}
- **07.8** The last way to sign in can never be removed (`07-google-and-email.mjs`): code was NOT_FOUND
- **07.9** Changing the email removes the Google link (`07-google-and-email.mjs`): refused: {"code":"NOT_FOUND","message":"Requested function was not found"}
- **08.12** The card step shows the server's amounts, not its own discount math (`08-prices-trials-and-promo-codes.mjs`): payment-step.tsx still works the discount out itself
- **09.1** signup-lead's steps are details 1, business 2, card 3, done 4 (`09-signups-list.mjs`): STEP_ORDER: expected {"details":1,"business":2,"card":3,"done":4}, got {"details":1,"business":2,"card":5,"done":6}
- **09.3** Old rows at email_code or password are labelled as the old signup (`09-signups-list.mjs`): email_code is not labelled as the old signup
- **09.4** The signups list says whether the email is verified and a password is set (`09-signups-list.mjs`): admin_signups has no email_confirmed / password_set
- **00.0** The math tests ran (`04-reminder-and-block.test.ts`): Cannot find module '../../../../apps/portal/src/lib/signup-verify' imported from 'D:/projects/drive247/docs/application/feat-001-account-creation/evals/04-reminder-and-block.test.ts'
- **08.6** #1 12900 cents at 0 percent off is 12900 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #2 12900 cents at 30 percent off is 9030 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #3 22900 cents at 30 percent off is 16030 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #4 34900 cents at 30 percent off is 24430 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #6 9999 cents at 30 percent off is 6999 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #7 5 cents at 30 percent off is 4 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #8 12900 cents at 100 percent off is 0 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #10 34900 cents at 30 percent off is 24430 cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.6** #edges 0 cents, 1 cent, the largest plan x 12 (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.1** #1 every amount is whole cents (`08-prices-trials-and-promo-codes.test.ts`): Error: promoBillCents is not in platform-promo-rules.ts yet
- **08.5** #5 14-day trial: exactly 3 paid bills are discounted, from 10 Dec (`08-prices-trials-and-promo-codes.test.ts`): Error: discountedBillDates is not in platform-promo-rules.ts yet
- **08.13** #9 30-day trial: exactly 3 paid bills are discounted, from 26 Dec (`08-prices-trials-and-promo-codes.test.ts`): Error: discountedBillDates is not in platform-promo-rules.ts yet
- **08.5** #no-trial no trial: the first 3 bills from signup (`08-prices-trials-and-promo-codes.test.ts`): Error: discountedBillDates is not in platform-promo-rules.ts yet

An eval did not finish or did not clean up after itself. See the run's output.
