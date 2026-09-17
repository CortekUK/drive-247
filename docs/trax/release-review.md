# What is pending, and what pushing it would actually do

Nothing has been pushed. `git push origin main` has not been run and is not proposed here.

## 1. Deployment triggers, as far as the repository shows

| Mechanism | Present? | Effect of a push to `main` |
|---|---|---|
| GitHub Actions | **none** — `.github/workflows` does not exist | nothing |
| `supabase db push` / `migration up` in any script or config | **none** (searched `package.json`, `turbo.json`, `scripts/`) | **no database change** |
| Vercel project config | **yes** — `vercel.json` at the root plus `apps/{portal,admin,booking,web,bonzah}/vercel.json` | the repository is wired for Vercel; a push to the tracked production branch builds and deploys those projects |

**What this means.** A push cannot change the database — no automation in the repository applies migrations, and the isolation SQL deliberately lives outside `supabase/migrations/` so that even a manual `supabase db push` would not pick it up.

A push probably **does** deploy application code to production for up to five Next.js apps. "Probably" is the honest word: whether auto-deploy is enabled, and which branch each Vercel project treats as production, is a Vercel-side setting that is not in this repository. **Check it before pushing** — Vercel → each project → Settings → Git → Production Branch and Ignored Build Step. The Vercel connector available in this session is not authorized, so this could not be verified from here.

Treat a code deployment and a database change as two separate approvals. Neither is requested by [`containment-review.md`](containment-review.md), which asks only for two `REVOKE` statements.

## 2. The nine pending commits

Ordered oldest first. "Runtime files" counts files under `apps/`, `shared/` or `supabase/functions/` that are not tests.

| # | Commit | Subject | Files | Runtime files | Deploys anything? |
|---|---|---|---|---|---|
| 1 | `9ee65883` | Support: tickets \| conversation \| Details and TRAX Summary | 71 | 19 | yes — portal + admin UI |
| 2 | `88c420a6` | Support: in the main sidebar, with an unread-message badge | 58 | 11 | yes — portal sidebar, edge function |
| 3 | `04ad5249` | Support: per-ticket unread-message badges | 45 | 6 | yes — portal + edge function |
| 4 | `0219ec4b` | TRAX and Support: sidebar highlight on hover, focus, pressed | 36 | 12 | yes — portal styling |
| 5 | `fdfe1ffe` | TRAX Summary: name the person, not "Tenant" | 34 | 2 | yes — shared support UI |
| 6 | `d0a0668f` | TRAX: a validated business-query layer | 13 | 9 | yes — `trax-support` edge function |
| 7 | `b70718de` | Prove tenant isolation against a real two-tenant database | 9 | **0** | no |
| 8 | `4b7c262c` | Prove isolation as real database roles; widen the fix | 11 | **0** | no |
| 9 | `c4d7c9cd` | Note the deliberate cross-account read | 2 | **0** | no |

Commits 7–9 contain SQL scripts that are not applied, tests, and documentation. They change no application code, so they cannot affect production behaviour even if deployed. Commits 1–6 are the TRAX and Support feature work; they carry every runtime change in the set.

Note that the edge-function changes in 2, 3 and 6 are not deployed by Vercel — Supabase edge functions deploy with `supabase functions deploy`, which nothing here automates. They ship only when someone runs that command.

## 3. How this is separated for review

Two local branches, created by copying files at their current state onto a base — no history is rewritten, nothing is discarded, no force-push is involved, and `main` is untouched.

```
containment/db-privileges    from origin/main
    docs/trax/remediation/*.sql              the staged fix, none applied
    docs/trax/containment-review.md          the decision package
    docs/trax/recovery-plan.md               recovery, backups, migration drift
    docs/trax/release-review.md              this file
    docs/trax/db-isolation-remediation.md    the finding
    tests/trax/tenant-isolation.mjs          12 tests, real roles
    tests/trax/remediation-sql.mjs            4 tests
    tests/trax/function-grants.mjs            6 tests
```

That branch is self-contained: those three suites need only the SQL files and an in-process Postgres, so a reviewer can run them without the TRAX feature work. It contains no application code, so a pull request from it deploys nothing.

`main` keeps the full history, features and security together, and is the branch to push once the feature work is separately approved. If the reviewer would rather the features went first, `trax/features` can be created at `d0a0668f` the same way.

## 4. Suggested sequence

1. Review [`containment-review.md`](containment-review.md) and decide on stages 0a and 0b. Nothing needs to be pushed or deployed for this.
2. Apply the approved stage(s) to staging, then production, in a named window, with [`recovery-plan.md`](recovery-plan.md) to hand.
3. Separately, review the feature commits and decide on a code deployment, after checking the Vercel Git settings in §1.
4. Separately again, plan the migration-drift reconciliation in `recovery-plan.md` §4. Do not run `supabase db push`.
