# Spec 08 · Premium checks through RentID

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 14, 15, 16 · **Status:** Draft

## What this covers

Running the premium checks after the standard check passes: licence status live, the driving record
and criminal record behind a switch; what RentID is sent; reading its answers; and every way a check
cannot run. The charge is spec 09. Facts about RentID are from `provider-answers.md`.

## Behaviour

- **08.1** Premium checks start by themselves when the standard check passes. Nobody presses anything.
- **08.2** When the standard check fails or needs a look, every premium check in the session is set to `not_run` with reason "The standard check did not pass" and is never sent.
- **08.3** A premium check whose consent was refused is not sent (spec 06.12).
- **08.4** A premium check whose service is `switched_off` when it would start is set to `not_run` with "Not available yet" and not sent.
- **08.5** Licence status calls `POST /api/v1/verifications/driver-license-checks` with only `first_name`, `last_name`, `driver_license_number`, `driver_license_state` and `dob` (YYYYMMDD), all from the standard check, and a `webhook_url` carrying our session check id.
- **08.6** Nothing else is sent to RentID: no email, phone, address, company name or list of companies.
- **08.7** The RentID `request_id` is saved as the check's `provider_ref`, and `premium_started` is recorded.
- **08.8** `400 STATE_NOT_SUPPORTED` sets the check to `could_not_check` with "Not available in this state yet". Not charged.
- **08.9** `402 INSUFFICIENT_CREDITS`, `402 INSUFFICIENT_FUNDS` or `402 PAYMENT_METHOD_REQUIRED` set the check to `could_not_check` with "Not available right now", and an operator notice is sent to Drive247's team. Not charged.
- **08.10** A network error, a timeout (15 seconds) or a 5xx sets the check to `could_not_check` with "Could not check, try again". Not charged.
- **08.11** `verification-v2-rentid-webhook` refuses with 401 a request whose `X-Rentid-Signature` `v1` is not HMAC-SHA256 of `<t>.<raw body>` with `RENTID_WEBHOOK_SECRET`, or whose `t` is more than 300 seconds from now.
- **08.12** The webhook finds our check by the id in its own URL and checks the `request_id` matches; it then fetches `GET /api/v1/verifications/{request_id}` and uses that, not the body.
- **08.13** A webhook for a check already finished changes nothing and returns 200.
- **08.14** The sweep polls every licence status check still pending after 2 minutes, so the 3 quick webhook attempts being missed never strands a check.
- **08.15** A licence status answer with status `complete` sets the check to `pass` when `outcome` is `valid`, otherwise `fail`, and the line reads "Licence active: <passenger_license.status>" (valid, expired, suspended, revoked, inactive, provisional, permit, not_found…).
- **08.16** A RentID answer `failed` sets the check to `could_not_check` with "Could not check, try again". Not charged.
- **08.17** A `complete` licence status answer of anything but valid leaves the customer Verified and sets `customers.verification_warning` to "Licence <status> (state check, <date>)".
- **08.18** A premium check that is `complete` creates its charge (spec 09), whatever the outcome.
- **08.19** Staff can run a premium check again for a Verified customer without a new standard check: `verification-v2` action `run-premium` `{ customerId, service }`, for services that are `live`. It makes a new session with that check only, needs no renter action, and uses the details already verified. It follows the role and subscription rules of spec 03.
- **08.20** The driving record and criminal record follow the same rules when switched on: the driving record by `motor-vehicle-reports` (async, same inputs as 08.5), the criminal record by `criminal-background-checks` (synchronous, `first_name`, `last_name`, `dob`, `reference_id` = our check id, no `webhook_url`).
- **08.21** The RentID key is read only inside edge functions, never returned to a browser or logged.

## Worked examples

None. (Charges are in spec 09.)

## Database

Spec 01. No new columns.

## Functions

- `_shared/verification/providers/rentid.ts` behind a `RecordProvider` interface:
  `startCheck(service, subject)`, `getResult(requestId)`. Base `https://api.rentid.io/api/v1`, header
  `X-API-Key: RENTID_API_KEY` (staging: an `ent_test_` key).
- `verification-v2-rentid-webhook` (`verify_jwt = false`), one URL for every company:
  `/functions/v1/verification-v2-rentid-webhook/<session check id>`.
- `verification-v2` action `run-premium` (08.19).
- Secrets: `RENTID_API_KEY`, `RENTID_WEBHOOK_SECRET`.

## Screens

Result lines on the customer's page and screen 3, e.g. "Licence active: valid", "Licence active:
suspended" in red, "Not available in this state yet". A Run again button for a premium line that is
could_not_check.

## Money and safety

Only finished checks are charged (08.8 to 08.10, 08.16, 08.18). RentID's sandbox cannot be made to
answer "suspended" (`provider-answers.md`); those answers are proved by calling the result handler with
recorded RentID answers, and by RentID's help when Ghulam gets it.

## Proof

| Statement | Proved by |
|---|---|
| 08.1 to 08.14, 08.16, 08.18, 08.19, 08.21 | `evals/08-premium-checks.mjs` (RentID sandbox where it can; a recorded answer fed to the handler where it cannot) |
| 08.15, 08.17 | `evals/08-premium-checks.test.ts` (Vitest on the answer-to-line mapping, every licence status value) |
| 08.20 | `evals/08-premium-checks.mjs`, run with the switch on in the eval only |

## Not in this spec

- The consent words for the driving and criminal records and the refusal process: waiting on a lawyer (PRD rules).
