# Branches and your test site

## The branches

| Branch | What it is | Who changes it |
|---|---|---|
| `main` | Production. What customers use. | Only a relay, when Ghulam says "relay to prod". |
| `staging` | The last stop before production. | Only a relay. |
| `ray1`, `ray2`, `ray3` | One permanent branch per person. Each has its own live sites. | Its owner. |

Nobody pushes to `main` or `staging` by hand.

## Your ray branch and its sites

| | `ray1` (Haris) | `ray2` (Hamza) | `ray3` (Hamna) |
|---|---|---|---|
| Landing page | `ray1.drive-247.com` | `ray2.drive-247.com` | `ray3.drive-247.com` |
| Super admin | `admin.ray1.drive-247.com` | `admin.ray2.drive-247.com` | `admin.ray3.drive-247.com` |
| Portal | `northwind.portal.ray1.drive-247.com` | `northwind.portal.ray2.drive-247.com` | `northwind.portal.ray3.drive-247.com` |
| Booking site | `northwind.ray1.drive-247.com` | `northwind.ray2.drive-247.com` | `northwind.ray3.drive-247.com` |

- Pushing to your ray branch puts your work on your sites in about five minutes.
- Your sites use the **staging database**, never production. Log in with the staging accounts.
- Your ray sites are where you test. A test on `localhost` does not count, because it does not show what a customer gets.

## One database for all of us

`staging`, the three ray branches and every local machine share one staging database.

| Rule | Why |
|---|---|
| Your machine always uses the staging database. | Only the deployed `main` talks to production. The `npm run dev` scripts enforce this. |
| You may apply your own database change and deploy your own functions to **staging**. | So you can build without waiting. |
| Say it in the group first. | The others are on the same database. |
| You break staging's data or a shared function, you fix it or take it back the same day. | Same reason. |
| Never to production. | Production only changes during a relay. |

## The cycle for one task

| Step | What you do |
|---|---|
| 1. Start level | Resync before you begin: see [03-staying-in-sync.md](03-staying-in-sync.md). |
| 2. Build | On your ray branch, or on a feature branch you merge into it. Write the PRD section, the specs and the evals as you go (see the next page). |
| 3. Push | Your ray sites update. |
| 4. Check by hand | Do part 1 of the QA report on your ray sites, on a real phone and a laptop. |
| 5. Pull request | From your ray branch. Say so in the group. |
| 6. Ghulam looks | He opens your ray site, reads the report, and says "relay to prod". |
| 7. The relay | Your work goes to `staging`, then to `main`. You tick part 2 of the QA report during it and part 3 straight after. |
| 8. Level again | Your ray branch is brought back level with `main`. |

One piece of work at a time on a ray branch. Whatever is on it goes out together.

A feature branch, when you use one, is named `<your-name>/<type>/<short-name>`, for example `hamna/feat/call-booking`. Take it from `staging`, and merge it into your ray branch when you want to see it on your live sites.

## Your first day

| Step | What you do |
|---|---|
| 1 | Clone the repo and run `npm install`. |
| 2 | Put the file `.staging-credentials.local` in the repo root. Ghulam sends it. It is never committed. |
| 3 | Save `SUPABASE_ACCESS_TOKEN` in your shell so it is always there. Ghulam sends it. |
| 4 | Run `npm run db:switch staging`. |
| 5 | Run `npm run synced` from `main`. The last line should read `ALL SYNCED <id>  code, database and edge functions`. Send that line to Ghulam. More in [03-staying-in-sync.md](03-staying-in-sync.md). |
| 6 | Check out your ray branch. |

To run an app on your machine, always use the root scripts: `npm run dev:portal`, `npm run dev:web`, `npm run dev:admin`, `npm run dev:booking`.

## Never

- Push to `main` or `staging`.
- Change the production database or deploy a function to production.
- Sign up, book or pay on production to test something.
- Run `supabase db push`.
- Commit a key, a token or a password.
