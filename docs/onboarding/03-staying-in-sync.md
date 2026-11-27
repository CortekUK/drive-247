# Staying in sync

"In sync" means everyone holds exactly the same thing: the same code, the same database shape, the same edge functions. One command checks all three and prints one line you can read out to a teammate.

```bash
npm run synced
```

## When to resync

| When | Why |
|---|---|
| Ghulam says "resync" in the group | Something was relayed to production. |
| Before you start a new task | So you build on what is live, not on last week. |
| Before you test on your ray site | So you are not testing against old code. |
| After your own work was relayed | Your ray branch has to come back level with `main`. |

## How to resync

Give this to your Claude, with your own ray branch in place of `rayN`:

```text
Resync my machine with the team. Do these in order and stop if one fails.

1. Check I have nothing uncommitted. If I do, stop and show me the list.
2. git fetch origin
3. Bring my local main level with GitHub main (fast-forward only).
4. Bring my ray branch (rayN) level with main. If rayN has commits main
   does not have, stop and tell me what they are. Do not throw them away.
5. npm run db:switch staging
6. Switch to main and run: npm run synced
7. Show me the last line it printed, and the short id of main and of rayN.
8. Switch back to rayN.

Never force-push. Never push to main or staging.
```

It only needs two things on your machine: the file `.staging-credentials.local` in the repo root, and `SUPABASE_ACCESS_TOKEN` saved in your shell. Ghulam sends both. See the first-day steps in [01-branches-and-your-test-site.md](01-branches-and-your-test-site.md).

## What you should see

```text
  My main          a1ba6624
  GitHub main      a1ba6624
  My staging       a1ba6624
  GitHub staging   a1ba6624
  I am on          a1ba6624 (main)

  Code             synced on a1ba6624

  Database         same as production   (…)
  Edge functions   same as production   (…)

  ALL SYNCED  a1ba6624  code, database and edge functions
```

The id will be different each time. What matters is that it is the same id on every row, and the same id your teammates see.

**Send the last line to Ghulam in the group**, with the id of your ray branch.

The check only reads. It never pulls, pushes, or changes a file, a database or a function. It takes one to a few minutes.

## When it does not say ALL SYNCED

| What you see | What it means | What to do |
|---|---|---|
| `You are N commits behind GitHub main` | Your code is old. | `git pull` on `main`, then run it again. |
| `You are working on … not on …` | You ran it from another branch. | Switch to `main` and run it again. |
| `N changed files not committed` | You have unsaved work. | Commit it on your ray branch, or put it aside, then run it again. |
| `Database and edge functions were NOT checked` | The token is not set in this terminal. | Save `SUPABASE_ACCESS_TOKEN` in your shell, open a new terminal, run it again. |
| `Database DIFFERENT` or `Edge functions DIFFERENT` | Staging does not match production. | See the next table. |
| `Could not reach GitHub` | No connection. | Check the internet, run it again. |

## Database or functions DIFFERENT

| Situation | Is it a problem? |
|---|---|
| Someone is building a feature and has put their own database change or function on staging | No. It is expected, and it clears when their work is relayed. Check in the group whose it is. |
| Nobody is building anything that touches the database or functions | Yes. Tell Ghulam. Do not try to fix staging or production yourself. |

To see exactly what differs in the database:

```bash
node docs/environments/database/db-eval.mjs --no-pdf
```

## Never, while resyncing

- Force-push.
- Push to `main` or `staging`.
- Throw away commits on your ray branch to make it "level". If your branch has work `main` does not have, stop and ask.
- Change production to make the check pass.
