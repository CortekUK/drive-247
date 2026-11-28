# Spec 07 · The standard check through Didit

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 6, 11, 12, 13 · **Status:** Draft

## What this covers

Creating the Didit session, the signed webhook, the fallback fetch, the ten result lines, the shared
rules (age, expiry, name, licence type, blocked list), Needs a look, and saving the details on the
customer. Facts about Didit are from `provider-answers.md`; each must be proved in Didit's sandbox.

## Behaviour

**Creating the Didit session**

- **07.1** `start-didit` calls `POST https://verification.didit.me/v3/session/` with the platform's one key (`DIDIT_API_KEY`), `workflow_id = DIDIT_WORKFLOW_ID`, `vendor_data = <our session id>`, `multi_account_segment = <tenant id>`, `metadata = { tenant_id, customer_id, session_id }`, `session_expiration_time` = seconds left until our `expires_at` (at least 3600), `callback = <booking origin>/id/<token>?done=1`, and `expected_details` with the customer's name.
- **07.2** `vendor_data` is our session id, not the customer id, so each of our sessions gets its own Didit session (Didit returns an existing unfinished session for the same `vendor_data`).
- **07.3** The Didit `session_id` is saved on our session (`didit_session_id`) and on the standard check (`provider_ref`), and `check_started` is recorded.
- **07.4** A 429 from Didit is retried after its `Retry-After` (at most 3 tries, at most 10 seconds in all); after that `start-didit` returns 503 and the page says to try again in a minute. No session is marked failed for it.
- **07.5** The Didit key is read only inside edge functions. It is never returned to a browser or written to a log.

**Receiving the result**

- **07.6** `verification-v2-didit-webhook` refuses with 401 a request whose `X-Signature-V2` is not the HMAC-SHA256, keyed with `DIDIT_WEBHOOK_SECRET`, of the body as canonical JSON (keys sorted, compact), or whose `X-Timestamp` is more than 300 seconds from now.
- **07.7** The webhook never trusts its body as the result. It finds our session by `vendor_data`, checks the Didit session id matches, then fetches `GET /v3/session/{id}/decision/` and uses that.
- **07.8** The company comes from our own session row, never from a field in the webhook.
- **07.9** A webhook for a session that is already finished, replaced or cancelled changes nothing and returns 200.
- **07.10** The same webhook delivered twice gives one result and one set of moments.
- **07.11** The sweep (spec 05) fetches the decision for every session `in_progress` for more than 3 minutes with a Didit session and no result, so a lost webhook never leaves a customer on In progress.

**The ten lines** (each line is `{ check, result, reason }` in the standard check's `lines`)

- **07.12** Line 1, real licence: pass when the `id_verifications[0]` status is Approved; fail with "The licence is not genuine, or could not be read" otherwise.
- **07.13** Line 2, live person: from `liveness_checks[0].status`. Line 3, face match: from `face_matches[0].status`, with the score.
- **07.14** Line 4, details saved: pass when name, date of birth, document number, expiry and region were all read; otherwise "could_not_check" naming the missing field. It does not decide Verified on its own.
- **07.15** Line 5, not expired: pass when the expiry date is on or after today (UTC). Fail "The licence is out of date" when before. could_not_check when no expiry was read.
- **07.16** Line 6, old enough: pass when the age on today's date (whole years from the date of birth) is at least `tenants.minimum_rental_age`. Fail "Under your minimum age of <n>". `not_set` when the company has no minimum. could_not_check with no date of birth.
- **07.17** Line 7, name matches: uses `driverNameMatchesDocument(customer.name, first_name, last_name)` from `_shared/secondary-driver-rules.ts`. On a fail the line shows both names.
- **07.18** Line 8, right type of licence: for a company accepting `drivers_license`, pass when `document_type` is "Driver's License" and `document_subtype` is not a learner's permit, provisional licence, instruction permit or ID card. Fail "This is a <kind>, not a full driving licence". A subtype the rule does not recognise is could_not_check. A passport passes only where the company accepts passports.
- **07.19** Line 9, not blocked, not a repeat: fail "On your blocked list" when the document number (upper case, spaces and dashes removed) matches an active `blocked_identities` row of this company. Fail "Same face as <name>" when Didit's `linked_records.same_face` names another customer of this company. Otherwise pass.
- **07.20** Line 10, kind of document: never a fail; it says e.g. "US driving licence (TX)" or "Passport (GB)".
- **07.21** The standard check is `pass` (customer Verified) when lines 1, 2, 3, 5, 7, 8, 9 pass and line 6 is pass or not_set.
- **07.22** It is `fail` (customer Failed) when any of lines 1, 2, 3, 5, 6, 7, 8, 9 fails.
- **07.23** It is Needs a look when Didit's status is "In Review", or when no line fails but one of lines 1, 2, 3, 5, 6, 7, 8, 9 is could_not_check. A check Drive247 could not make is never a pass.
- **07.24** Didit "Declined" with no line we can name fails with reason "Didit declined the check".

**Saving**

- **07.25** On pass or Needs a look, the details read are written to the customer: `date_of_birth`, `license_number`, `license_state` (Didit's `region`), `licence_expiry_date`, `licence_document_type`, `licence_document_subtype`, `licence_issuing_country`, and the address fields when read; `identity_details_source` becomes `verified`.
- **07.26** On fail, nothing on the customer is overwritten.
- **07.27** A customer that fails line 9 on the blocked list is marked `is_blocked = true` with `blocked_reason` from the list, as today.
- **07.28** The licence photos and selfie are copied from Didit's short-lived links into the private bucket (spec 12) within the same run, and only the storage paths are kept.
- **07.29** The result writes `standard_result`, sets the standard check's `result`, `lines`, `raw` and `finished_at`, and moves the session and the customer to verified, needs_review or failed (spec 03.8).
- **07.30** Each finished standard check keeps `provider_cost_cents = 33` against the company, though the company pays nothing, so our cost per company can be read.
- **07.31** All rules in 07.15 to 07.23 live in one file, `_shared/verification/rules.ts`, which the webhook, the sweep and the Vitest file all import.

## Worked examples

The age rule (07.16), today = 29 Nov 2026, minimum 21.

| # | Date of birth | Working | Line 6 |
|---|---|---|---|
| 1 | 2005-11-29 | 21st birthday is today | pass |
| 2 | 2005-11-30 | 21st birthday tomorrow, so 20 today | fail |
| 3 | 2004-02-29 | 22 on 28 Feb / 1 Mar 2026; 22 today | pass |
| 4 | none | no date | could_not_check |

The expiry rule (07.15), today = 29 Nov 2026: expiry 2026-11-29 pass; 2026-11-28 fail; none could_not_check.

## Database

Spec 01. The customer columns in 07.25 exist (`date_of_birth`, `license_number`, `license_state`,
`address_*` on staging) or are added by spec 01.

## Functions

- `verification-v2-link` action `start-didit` (spec 06).
- `verification-v2-didit-webhook` (`verify_jwt = false`; signature in 07.6). One webhook URL on
  Didit's side for every company.
- `_shared/verification/providers/didit.ts`: `createSession()`, `getDecision()`,
  `deleteSession()` (for 05.8), behind the `IdentityProvider` interface in `_shared/verification/provider.ts`.
- Secrets on the Supabase project: `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`.
  Staging uses the sandbox application (`sk_test_`).

## Screens

The result lines show on the customer's page (spec 03) and the dialog's screen 3 (spec 05): one line
per check, Pass, Fail, Could not check or Not set, with the reason in plain words when not a pass.

## Money and safety

The standard check is free to companies (spec 09). The webhook cannot be forged (07.6) and cannot
point a result at another company (07.8). Photos never stay on Didit's links.

## Proof

| Statement | Proved by |
|---|---|
| 07.1 to 07.4, 07.6 to 07.11, 07.19, 07.21 to 07.30 | `evals/07-standard-check.mjs` (Didit sandbox, `sandbox_scenario` and `/simulate/`) |
| 07.12 to 07.18, 07.20, 07.23, 07.31 (rules) | `evals/07-standard-check.test.ts` (Vitest on `rules.ts`, the examples above and a learner's permit, a passport, an unknown subtype) |
| 07.5 | `evals/12-safety.mjs` |

## Not in this spec

- Premium checks (spec 08). Pricing (spec 09).
- A US licence's class or endorsements: Didit does not return them (`provider-answers.md`).
