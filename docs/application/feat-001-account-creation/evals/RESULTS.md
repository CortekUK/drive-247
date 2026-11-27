# Eval results · feat-001-account-creation

**FAIL** · 55/57 statements proved · 98 checks · 2026-11-27 15:34 UTC

Run on staging by `npm run eval -- feat-001`, at commit `464f68fb` on `hamza/feat-001/account-creation` (with uncommitted changes).
This file is written by the command. Do not edit it by hand.

| Statement | Result | Checks | Eval |
|---|---|---|---|
| 01.2 | pass | 1 | `01-signup-steps.mjs` |
| 01.3 | pass | 1 | `01-signup-steps.mjs` |
| 01.4 | pass | 1 | `01-signup-steps.mjs` |
| 01.5 | pass | 1 | `01-signup-steps.mjs` |
| 01.6 | pass | 1 | `01-signup-steps.mjs` |
| 01.10 | pass | 1 | `01-signup-steps.mjs` |
| 01.13 | pass | 1 | `01-signup-steps.mjs` |
| 02.1 | pass | 1 | `02-landing-in-the-portal.mjs` |
| 02.3 | pass | 1 | `02-landing-in-the-portal.mjs` |
| 03.1 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.2 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.4 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.5 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.6 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.7 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.8 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.9 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.10 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.11 | pass | 1 | `03-verify-and-password-window.mjs` |
| 03.13 | pass | 1 | `03-verify-and-password-window.mjs` |
| 04.4 | pass | 5 | `04-reminder-and-block.test.ts` |
| 04.6 | pass | 9 | `04-reminder-and-block.test.ts` |
| 04.7 | pass | 2 | `04-reminder-and-block.test.ts` |
| 05.2 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 05.3 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 05.6 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 05.7 | pass | 1 | `05-sign-in-with-a-code.mjs` |
| 06.3 | pass | 1 | `06-profile.mjs` |
| 06.5 | pass | 1 | `06-profile.mjs` |
| 06.6 | pass | 1 | `06-profile.mjs` |
| 06.7 | pass | 1 | `06-profile.mjs` |
| 06.8 | pass | 1 | `06-profile.mjs` |
| 06.9 | pass | 1 | `06-profile.mjs` |
| 06.10 | pass | 1 | `06-profile.mjs` |
| 07.4 | pass | 1 | `07-google-and-email.mjs` |
| 07.5 | pass | 1 | `07-google-and-email.mjs` |
| 07.6 | pass | 1 | `07-google-and-email.mjs` |
| 07.7 | pass | 1 | `07-google-and-email.mjs` |
| 07.8 | pass | 1 | `07-google-and-email.mjs` |
| 07.9 | pass | 1 | `07-google-and-email.mjs` |
| 08.1 | pass | 1 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.2 | pass | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.3 | pass | 2 | `08-prices-trials-and-promo-codes.mjs`, `08-prices-trials-and-promo-codes.test.ts` |
| 08.4 | pass | 1 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.5 | pass | 2 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.6 | pass | 10 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.7 | pass | 3 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.8 | pass | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.12 | pass | 1 | `08-prices-trials-and-promo-codes.mjs` |
| 08.13 | FAIL | 6 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.14 | pass | 1 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.15 | pass | 2 | `08-prices-trials-and-promo-codes.test.ts` |
| 08.18 | pass | 10 | `08-prices-trials-and-promo-codes.test.ts` |
| 09.1 | pass | 1 | `09-signups-list.mjs` |
| 09.2 | pass | 1 | `09-signups-list.mjs` |
| 09.3 | pass | 1 | `09-signups-list.mjs` |
| 09.4 | FAIL | 1 | `09-signups-list.mjs` |

## What failed

- **09.4** The signups list says whether the email is verified and a password is set (`09-signups-list.mjs`): admin_signups has no email_confirmed / password_set
- **08.13** #all every trial from 0 to 90 days gets exactly 3 discounted bills (`08-prices-trials-and-promo-codes.test.ts`): AssertionError: 2027-01-31 + 89 days: expected [ '2027-04-30', '2027-05-30', …(2) ] to deeply equal [ '2027-04-30', '2027-05-30', …(1) ]
