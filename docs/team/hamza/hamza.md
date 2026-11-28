# Hamza

Everything Hamza has been asked to do on Drive247, in order. One file per task, in this folder.

## How Hamza works

| | |
|---|---|
| Branch | `ray2` |
| Landing page | `ray2.drive-247.com` |
| Super admin | `admin.ray2.drive-247.com` |
| Portal | `northwind.portal.ray2.drive-247.com` |
| Booking site | `northwind.ray2.drive-247.com` |
| Database | Staging. Never production. |
| Path for every task | PRD, specs, evals, QA report, then a pull request from `ray2`. |

## Tasks

| Day | Task | File | State |
|---|---|---|---|
| Wed 25 Nov 2026 | Landing page QA (QA-1) | [2026-11-25-wednesday-landing-page-qa.md](2026-11-25-wednesday-landing-page-qa.md) | Done. Merged to `main` (PR #33). |
| Thu 26 Nov 2026 | Round 1: account creation and the account | [2026-11-26-thursday-account-creation.md](2026-11-26-thursday-account-creation.md) | Given. In progress. |
| Fri 27 Nov 2026 | Round 2: promo codes, campaigns and referrals | [2026-11-27-friday-promo-codes-campaigns-referrals.md](2026-11-27-friday-promo-codes-campaigns-referrals.md) | Brief written. Starts after round 1 is handed in. |

## Decisions already made for his tasks

| Date | Decision |
|---|---|
| 26 Nov | Signup becomes About you, Business, Card. The email code and the password move into the portal. |
| 26 Nov | The portal dialog is required. A reminder on every visit; after 3 days the portal asks before continuing. Google signups never see it. |
| 27 Nov | Which code wins: during a campaign the new company gets the campaign discount and the referrer still gets credit. |
| 27 Nov | A referral counts only after the new company has paid its first bill. |
| 27 Nov | Black Friday becomes the first campaign, and it is Hamza's. |

## Parked for a later round

- Payment links sent by sales (`/subscribe/…`).
- Where signups come from: "How did you hear about us", referral and campaign on the Signups page.
- Follow-up emails to people who left signup halfway.
- Staff invites (a second person joining a company).
- Emails around signup: welcome, trial ending, first bill.

## Open

- QA report for the landing page pass.

Keys and tokens are never kept in this folder.
