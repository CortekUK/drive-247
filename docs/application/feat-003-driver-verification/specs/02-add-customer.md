# Spec 02 · Add customer without verifying, and typed details

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** 1, 2 · **Status:** Draft

## What this covers

The v2 add-customer dialog loses everything to do with the licence and the ID check (D1 to D3),
and the customer's page lets staff type licence details by hand, marked "Typed, not verified" (D4).
It stops at saving the customer; the Verify button is spec 03.

## Behaviour

- **02.1** For a Northwind staff member, the add-customer dialog has these screens, in order: who is renting (full name), how to reach them (email, phone), a couple more things (status, gig driver), who to call (emergency contact name and relationship, optional), and how to reach them (emergency phone, email, address, optional).
- **02.2** The dialog has no date of birth field, no licence number field, no ID number field and no "Verify their ID" screen.
- **02.3** Saving a new customer writes `verification_status = 'not_verified'`, `identity_details_source = null`, and `identity_verification_status = 'unverified'`.
- **02.4** Saving a new customer creates no verification session of either kind (no `verification_sessions` row, no `identity_verifications` row).
- **02.5** A customer can be saved with neither email nor phone.
- **02.6** The duplicate-email check still runs: a second customer with the same email (any case) in the same company is refused with the existing message.
- **02.7** The blocked-list check on a typed ID number no longer runs in the add dialog (there is no number to check). The blocked list is checked on the result instead (spec 07).
- **02.8** On the customer's page, a staff member with edit access can type the date of birth, licence number, licence state and licence expiry. Saving them sets `identity_details_source = 'typed'`.
- **02.9** Typed details are shown with the words "Typed, not verified".
- **02.10** Typing details does not change `verification_status`.
- **02.11** A staff member without edit access to Customers cannot save typed details: the fields are read-only on screen. (Found while proving this: the `customers` table's row rules allow any signed-in user to update any customer, so the database does not enforce this for any customer field today. That is wider than this feature and is reported to Ghulam in the QA report; it is not changed here.)
- **02.12** When a later check passes, the details read from the licence replace the typed ones and `identity_details_source` becomes `verified` (spec 07).
- **02.13** Editing any of those details by hand after they were verified sets `identity_details_source` back to `typed`, and the existing "details have changed since the verdict" banner shows.
- **02.14** Typing details by hand writes an audit entry `customer_details_typed` with the fields changed.
- **02.15** Every other company (not Northwind) sees today's add dialog, unchanged.

## Worked examples

None.

## Database

No new columns (they are in spec 01). The update in 02.8 goes through the existing `customers`
policies; 02.11 relies on the existing rule that viewers have no update grant.

## Functions

None. The dialog writes through the Supabase client as today.

## Screens

- **Portal, `components/customers-v2/customer-form-dialog-v2.tsx`.** It is opened only from
  `app/(dashboard)/customers/page.tsx` (line 1445), behind `useV2("chrome")`, so changing it affects
  only Northwind. The `STEPS` array loses step 0's `date_of_birth` and the whole step 2
  ("Their licence"); `checkBlocked()` and its field errors go; the follow-up screen
  (lines 590 to 647) and the mount of `verify-id-screen-v2.tsx` (lines 580 to 589) go. Email and phone
  move onto the first screen if they fit the 3 by 4 grid; otherwise they stay on screen 2.
- **Portal, the customer's page, Identity section** (`customers-v2/customer-detail/`): the date of
  birth and licence fields become editable for `canEdit('customers')`, with a "Typed, not verified" or
  "Verified" mark beside them.

## Money and safety

None: nothing is charged, and typed details are labelled as unchecked.

## Proof

| Statement | Proved by |
|---|---|
| 02.3, 02.4, 02.5, 02.10 | `evals/02-add-customer.mjs` (does the same writes the dialog does) |
| 02.1, 02.2, 02.6, 02.7, 02.8, 02.9, 02.11, 02.13, 02.14, 02.15 | QA report (what the dialog and the customer's page show and save; 02.6, 02.8, 02.13 and 02.14 are done by the page's own code, so a person checks them there) |
| 02.12 | QA report (a real licence through Didit, spec 07) |

## Not in this spec

- The Verify button and statuses (spec 03).
- The old v1 add-customer modal (`customer-form-modal.tsx`): unchanged.
