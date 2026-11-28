# Spec 12 · Safety, privacy and isolation

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** all · **Status:** Draft

## What this covers

The rules that hold across the module: one company never sees another's data, photos are private,
keys never leave the server, everything is logged, and the old verification flows keep working.

## Behaviour

- **12.1** A staff member of company B gets nothing back for company A's sessions, checks, events or charges, whether they guess an id in the REST API or pass it to `verification-v2`.
- **12.2** Licence photos and selfies from this module are stored in the private bucket `verification-documents` under `<tenant id>/<customer id>/<session id>/`.
- **12.3** An anonymous request for a file in that bucket is refused.
- **12.4** Staff see the photos only through signed links that last 10 minutes, made by `verification-v2` action `photos` for their own company's customer.
- **12.5** Deleting a customer removes their files from the bucket (on delete, through the cascade's clean-up).
- **12.6** No response of `verification-v2`, `verification-v2-link` or the webhooks contains `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `RENTID_API_KEY` or `RENTID_WEBHOOK_SECRET`, and none of them logs a key or a token.
- **12.7** The renter's pages never receive a licence number, a date of birth or a photo (spec 06.3).
- **12.8** Every start, reminder, cancel, re-run of a premium check, typed detail and photo view writes an audit entry with the staff member.
- **12.9** Today's flows keep working unchanged: `create-ai-verification-session`, `process-ai-verification` and `send-verification-link-v2` are not edited, and a session made by the old flow still completes.
- **12.10** The booking site's `/verify/<token>` page is not edited.
- **12.11** Secondary drivers, the invite registration and the booking-site check still write `identity_verifications` rows as before.
- **12.12** No file of this module is imported by a v1 screen, and no shared v1 file is edited: a shared screen that needs a change is forked to a `-v2` file.

## Worked examples

None.

## Database

Storage bucket `verification-documents` (already exists on staging, private, not in any migration):
the migration of spec 01 creates it if missing (`public = false`) and adds policies: no `anon` access;
`service_role` writes; reads only through signed links.

## Functions

`verification-v2` action `photos` `{ sessionId }` → `{ front, back, selfie }` signed URLs, 600 seconds.
Any staff member of the customer's company may call it, viewers included (they can see the result
today). A staff member of another company gets 404.

## Screens

The customer's page shows the photos through the signed links (spec 03).

## Money and safety

This spec is the safety net: cross-company reads (12.1), public photos (12.2, 12.3), leaked keys
(12.6). Today's public `customer-documents` bucket is not changed in this task; what moving the old
files would take is written up for Ghulam in the QA report.

## Proof

| Statement | Proved by |
|---|---|
| 12.1 to 12.6, 12.8, 12.9, 12.11 | `evals/12-safety.mjs` |
| 12.10, 12.12 | `evals/12-safety.mjs` (git diff of the listed files against `staging` is empty) |
| 12.7 | `evals/06-link-and-renter-pages.mjs` (06.3) |

## Not in this spec

- Moving today's photos out of the public bucket (later task, Ghulam to decide).
- The lawyer's retention period (PRD rules).
