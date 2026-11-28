# feat-003 · Provider answers (brief sections 9.5 and 10.1)

Read on 28 Nov 2026. RentID from its developer documents (the PDFs Haris has: API Reference, Getting
Started, Webhooks, Errors, Overview, Protection). Didit from docs.didit.me and didit.me/pricing.
Nothing here was tried against a live or sandbox API yet. The specs cite this file.

## RentID (section 10.1)

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | Credits per check | **Not in the docs.** Cost per product is on the account's Billing › Rates and Credits tabs. Credits pay only for the driving record (`motor-vehicle-reports`) and the licence check (`driver-license-checks`). **The criminal check cannot use credits**: it is billed at the account's standard rate, and needs the product priced on the account (else `403 PRICING_REQUIRED`). | Getting Started § What a Call Costs, § Which Endpoints Credits Pay For |
| 2 | State fees | Driving record and licence check only: "the record fee charged by the state that issued the license, passed through at cost". The list is a PDF ("State record fees") and a table on the Billing page, itemised on RentID's invoice. **No response carries the fee.** Credits never pay it: it goes on the default payment method, which is required (`402 PAYMENT_METHOD_REQUIRED`). | API Reference § Motor Vehicle Report / Driver License Check › Billing; Errors § State record fees |
| 3 | State coverage | Licence check "not available in every state"; refused with `400 STATE_NOT_SUPPORTED`. No list in the docs: ask RentID. Driving record: no coverage list, no state error documented. Criminal: optional `jurisdictions`. Non-US: not in the docs. | API Reference § Supported States; § Criminal Background Check |
| 4 | Inputs | Licence check and driving record: `first_name`, `last_name`, `driver_license_number`, `driver_license_state` (two letters); optional `dob` (YYYYMMDD), `webhook_url`. No `reference_id`. Criminal: `first_name`, `last_name`; optional `dob` ("strongly encouraged"), `phone`, `ssn`, `email`, `reference_id`, `search_type`, `subject_type`, `jurisdictions`, `include_photos`, `screening_profile_id`; **no `webhook_url`**. Unknown fields are refused. The standard check gives us everything the licence check and driving record need. | API Reference § each check › Request Body |
| 5 | Consent | **Not in the docs.** No hosted page for these three checks ("Step for the person: No"). Consent, FCRA permissible purpose and adverse action are all ours. | API Reference § Verifications › Overview |
| 6 | Timing | Criminal: synchronous, the report is in the answer. Licence check and driving record: asynchronous (`pending`), result by webhook (`verification.completed` / `.failed` / `.updated`) or by polling `GET /api/v1/verifications/{request_id}` (free). How long: not in the docs. | API Reference § Synchronous vs Asynchronous; Webhooks § Event Catalog |
| 7 | When RentID bills us | "Only successful calls made with a live key are charged; failed calls and sandbox calls are free." Credits leave the balance when the call starts and come back if it fails. **Not stated:** whether an async check that was accepted and later ends `failed` is charged. | API Reference § Endpoints; Getting Started § Fee Schedule |
| 8 | Sandbox | `ent_test_` keys, never billed, may have a daily cap (`429 SANDBOX_LIMIT_REACHED`). **No documented way to force outcomes** (suspended, DUI, criminal record). | Getting Started § Sandbox and Live Keys |
| 9 | Results | Licence check: `outcome` valid / restricted / not_valid / not_found / pending / failed / unknown; `passenger_license` and `commercial_license` each with `status` (valid, expired, suspended, revoked, inactive, provisional, permit, transferred, not_found, invalid, unknown), `license_class`, `expiration_date`. No "cancelled". Driving record: `outcome` clear / consider / not_found / rejected / suspended / failed / pending / unknown; `license` {class, status, restrictions, endorsements…}; `violations[]` {date, description, points, state}; `accidents[]`; `suspensions[]`. **No DUI field**: a DUI is free text in `violations[].description`. Criminal: `outcome` clear / records_found, `record_count`, `records[]` with charges (felony / misdemeanor / …). | API Reference § Report Schemas |
| 10 | One account for many companies | **Not in the docs.** Ask RentID in writing. | Getting Started § How It Works |
| 11 | Balance | No balance endpoint. `X-Rentid-Credits-Remaining` header on credit-paid calls; `402 INSUFFICIENT_CREDITS` when empty; `billing.low_balance` webhook for the prepaid balance. | Getting Started § Response Headers, § Running Out of Credits |
| 12 | Webhooks | `X-Rentid-Signature: t=…,v1=…`, HMAC-SHA256 of `<t>.<raw body>` with the `whsec_` secret, 5 minutes tolerance. 3 attempts within about 3 seconds, then dropped: polling fallback needed. | Webhooks § Verifying Signatures, § Delivery |
| 13 | Rate limit | 100 requests a minute per key; `429 RATE_LIMIT_EXCEEDED`; monthly caps `429 MONTHLY_CAP_REACHED`. | Getting Started § Rate Limiting |

## Didit (section 9.5)

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | Licence class, restrictions, endorsements | **Not returned.** `document_type` is "Driver's License" for full licences, CDLs and learner's permits alike. **`document_subtype` tells them apart** (e.g. `TEXAS_DRIVER_LICENSE_GENERIC`, `FLORIDA_LEARNER_PERMIT`, `MARYLAND_PROVISIONAL_DL`, `FLORIDA_ID_CARD_REAL_ID`). New subtypes appear without notice. The state is in `region`; `issuing_state` is the country (`USA`). | docs.didit.me/core-technology/id-verification/document-subtypes-id-verification; /reference/data-models |
| 2 | Back barcode | Decoded into `id_verifications[].barcodes[]` {type `PDF_417`, data, data_raw, side}. Shape of `data` not documented. The AAMVA signature is never checked, so the barcode is not proof by itself. | /reference/data-models; /warnings-id-verification |
| 3 | Carry on after stopping | Partly: creating again for the same unfinished session returns the same session; "Continue on another device" exists. What the hosted page does when reopened mid-way: **not confirmed**, prove in the sandbox. | /sessions-api/create-session |
| 4 | Abandoned / Expired | Expired: the lifetime passed before the link was opened. Abandoned: started, not finished in time (no number given). `session_expiration_time` 3600 to 2419200 seconds, default 7 days. | /integration/verification-statuses |
| 5 | Data location | EU (Ireland) only; US "coming soon". Retention set in the console, 1 month to 10 years. | /console/applications; /console/data-retention |
| 6 | Blocklist by API | Yes: `POST /v3/blocklist/add/` (face, document, phone, email by session). | /management-api/blocklist/add |
| 7 | Delete by API | Yes: `DELETE /v3/session/{session_id}/delete/`; `privacy_erasure` also removes face templates. | /console/data-retention |
| 8 | Price | Since 1 Nov 2026: full check $0.33 per finished session; $10 free credit a month; white label $0.10 list, $0.09 on Scale ($299 a month). Unfinished checks are not charged. | /getting-started/pricing; didit.me/pricing |

Also confirmed: one unfinished session per (`workflow_id`, `vendor_data`): a second create returns it
(and resets its expiry if `session_expiration_time` is sent); no opt-out. Webhook `X-Signature-V2`
over sorted compact JSON, `X-Timestamp` within 300 s, retried twice (about 1 and 4 minutes), only on
5xx/404/timeout; source IP `18.203.201.92`. Fine steps (front, back, selfie) come from
`GET /v3/session/{id}/events/`, not from the decision. Session creation is limited to 300 a minute
(the general write limit), not 600. Sandbox: `sk_test_`, 500 creates a day, `sandbox_scenario` values
such as `approve`, `decline_document_expired`, `decline_minimum_age`,
`decline_face_match_low_similarity`, `decline_liveness_attack`, `review_face_match_borderline`;
`/simulate/` to move a session; sandbox licences carry no state.

## Decided by Ghulam, 28 Nov 2026 (after reading the points above)

- **Assume and build.** Where RentID's documents leave a gap, the specs take the best assumption
  below and the build goes ahead. Each assumption is one value in the price list or one line of
  config, so it is changed in one place when RentID answers.
- **Didit data in the EU (Ireland) is acceptable for now.** Data location is not a blocker.
- **Accounts.** The Didit account is opened with Neema's Cortek Gmail, the same way the RentID
  account was opened.
- **Staging may be changed** for this feature: the migration and the new functions go onto staging.
  It is shared and can be put back.
- **Northwind on staging gets a Stripe test-mode subscription** on the UAE test account, for the
  billing evals and the test clock.
- The six choices in the specs are accepted as written: the renter's link is `/id/<token>`;
  past due gets no premium checks; the licence check carries a state fee; licence status is
  $2.99 + $0.50; "Save this email on the customer" is ticked by default; dates use UTC.

## Assumptions taken (to replace when RentID confirms)

| # | Gap | Assumed | Where it lives |
|---|---|---|---|
| A1 | Credits per licence status check | 1 credit = $2.99 (`provider_cost_cents = 299`) | `verification_services` row `licence_status` |
| A2 | Credits per driving record | 1 credit = $2.99, plus the state fee | row `driving_record` (switched off) |
| A3 | Criminal record rate (not credits) | $2.99, no state fee | row `criminal_record` (switched off) |
| A4 | State fees | No fee rows until the PDF arrives; a charge in a state with no row is held, not guessed (spec 09.10) | `verification_state_fees` |
| A5 | Licence status state coverage | Every state is tried; `STATE_NOT_SUPPORTED` marks it not covered and is not charged (spec 08.8) | `rentid.ts` |
| A6 | One account for many companies | Allowed; Drive247 is the permissible-purpose user and keeps each company's consent record | spec 06.11 |
| A7 | Async check accepted then `failed` | Not charged (only `complete` is charged) | spec 09.7 |
| A8 | Forcing RentID outcomes in tests | Recorded answers fed to the result handler | spec 08 Proof |

## Didit account (set up 28 Nov 2026)

- Sandbox application under Neema's Cortek Gmail. Workflow **Basic KYC** (`d11038b4-602c-45ef-a280-8d9e353e3824`),
  published: ID verification (passport and driver's licence), passive liveness, face match, device and IP. $0.33 per
  completed session live, free in the sandbox.
- Staging secrets set: `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_WORKFLOW_ID`. The webhook destination points at staging `verification-v2-didit-webhook` (v3, status.updated + data.updated). Create and delete session tested in the sandbox: 201 and 200; `session_expiration_time: 86400` is honoured.
- Didit's own integration notes, which correct spec 07.6 and 07.10: check freshness against the **signed body
  `timestamp`**, never the `X-Timestamp` header; de-duplicate on `event_id`; canonicalise as
  shortenFloats → sortKeys → `JSON.stringify`. Balance: `GET /v3/billing/balance/`. Webhook destinations can be
  listed with `GET /v3/webhook/destinations/` (used to confirm the URL points at staging).
