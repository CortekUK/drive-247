# Edge function evals

These prove staging runs the same edge functions as production. The target is
what prod actually has deployed, not what is in git.

```bash
export SUPABASE_ACCESS_TOKEN=...
node evals/environments/functions/fn-eval.mjs          # compare (about 30 seconds)
node evals/environments/functions/copy-from-prod.mjs   # staging drifted: copy prod's functions across
```

Exit code is 0 only when everything is identical. Every run writes a PDF to `reports/`.

## Files

| File | Question it answers | Writes anywhere? |
|---|---|---|
| `fn-eval.mjs` | Are staging's functions the same as prod's? Five checks, below. | No |
| `copy-from-prod.mjs` | Staging drifted, how do I fix it? Uploads prod's deployed bundles to staging byte for byte, reads each one back to prove it, then runs fn-eval. `--dry-run` shows the plan, `--prune` deletes staging-only functions. About 75 minutes from empty, quick when little changed. | Staging only |
| `accepted-differences.json` | Every difference we decided is fine, each with a reason. | |
| `.fingerprints.json` | Cache. A function's code only changes on deploy, so each deployed version is downloaded once. Gitignored; `--no-cache` ignores it. | |

Shared plumbing (Supabase calls, exceptions, the report) lives in `../database/lib.mjs`.

## The checks

| Check | Passes when |
|---|---|
| `same_list` | Staging has every function prod runs, and no extras. |
| `same_lock` | Each function has the same `verify_jwt` setting. |
| `same_code` | Each function's deployed bundle is the same bytes on both sides. |
| `same_answer` | Each function gives the same status to an `OPTIONS` request, so one that crashes on start shows up. |
| `no_prod_pointers` | No staging function carries the prod address or a prod key. |

## Rules that keep it honest

- **Production is never written to**, and never sent a real request. Only `OPTIONS` is
  sent to a function: even an empty POST could start a payment or email job.
- **Empty is not a pass.** Prod must report at least 300 functions.
- **A deploy is not trusted until read back.** `copy-from-prod.mjs` downloads each
  function from staging after uploading it and compares the bytes.

## Accepted differences (2), approved by Ghulam on 24 Nov 2026

| Function | What | Why it is fine |
|---|---|---|
| `turo-bridge-ingest` | Mentions the prod ref | Only inside a code comment |
| `emergency-bootstrap` | Has prod's URL written into its code | On staging it calls prod with staging's key and is refused. Broken on staging, harmless to prod. Fix: read `SUPABASE_URL`, redeploy both sides. |

## Not covered

- Real behaviour (take a payment, send an email). That needs seed data and belongs
  to the live test suite.
- The 9 webhook signing secrets and the live keys are not on staging, so webhook
  and live-mode functions will refuse requests there.
