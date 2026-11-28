# Haris

Everything Haris has been asked to do on Drive247, in order. One file per task, in this folder.

## How Haris works

| | |
|---|---|
| Branch | `ray1` |
| Landing page | `ray1.drive-247.com` |
| Super admin | `admin.ray1.drive-247.com` |
| Portal | `northwind.portal.ray1.drive-247.com` |
| Booking site | `northwind.ray1.drive-247.com` |
| Database | Staging. Never production. |
| Path for every task | PRD, specs, evals, QA report, then a pull request from `ray1`. |

## Tasks

| Day | Task | File | State |
|---|---|---|---|
| Sat 28 Nov 2026 | Driver verification, part 1: verify from the Customers tab, all checks, premium charges | [2026-11-28-saturday-driver-verification-part-1.md](2026-11-28-saturday-driver-verification-part-1.md) | Brief written 28 Nov. First asked on Thu 26 Nov without a brief. Due date to be set by Ghulam (the old one was end of day Sat 28 Nov). |

## Decisions already made for his tasks

| Date | Decision |
|---|---|
| 28 Nov | Add customer no longer verifies. Verify is its own button on the row and the customer page. |
| 28 Nov | The standard check is free and runs on Didit. Premium checks run on RentID and cost the company our cost plus $0.50, added to the next subscription bill. |
| 28 Nov | Only Drive247, Didit and RentID checks are live. The rest show as "Coming soon". |

The full list (D1 to D20) is in the task file. The research is in `docs/research/driver-verification-module.md`.

## Open

- Black Friday (BF30): moving it into a campaign is now Hamza's (decided 27 Nov). See `../hamza/`.

Keys and tokens are never kept in this folder.
