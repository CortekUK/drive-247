# Cron Simulation — Edge-Case Audit (PRE-BUILD, BINDING AMENDMENTS)

**Date:** 2026-07-08 · **Method:** 6 specialized hunters (data-coherence, concurrency, async-feedback, auth/env, external-truth, drift/ops) + adjudicating synthesizer; every finding verified against repo source with file:line evidence.
**Scope:** [CRON_SIMULATION_TESTING_DESIGN.md](CRON_SIMULATION_TESTING_DESIGN.md) + [CRON_SIM_DEVPANEL_SPEC.md](CRON_SIM_DEVPANEL_SPEC.md).
**Verdict:** 24 genuine gaps — **5 blockers, 9 majors, 10 minors**. Architecture is sound (backdate + dispatch mechanism confirmed correct; PAYG idempotency genuinely safe). The v1 as previously specced would have shipped a security hole plus a happy path that silently does nothing. All fixable: **+2.5 person-days** (total ~11 pd end-to-end).

## Blockers (must fix before build)

| # | Finding | Evidence |
|---|---|---|
| 1 | **`sim_shift` RPC is an open door**: table-only allowlist (prose claimed columns), default EXECUTE to PUBLIC never revoked, no env guard, silent 0-row no-op, unbounded `p_days`. Any authenticated staging user can call it via PostgREST, bypassing all three sim-control guards. | Spec SQL verified: no col check, no REVOKE, no `GET DIAGNOSTICS` |
| 2 | **Identity check keys on the wrong column** — `app_users.id` vs the actual `auth_user_id`. Every panel call would 403 forever. This codebase was bitten by this exact mistake before (`20251222150000_fix_super_admin_rls.sql`). | auth-store.ts:45,153 |
| 3 | **v1 golden path broken end-to-end**: `dev:lastRentalId` written by nothing; DevPanel "Create Rental" only pre-fills a form (insert is in rentals/new, `status:'Pending'`, PAYG cols NULL); fire filters `status='Active'` → `processed:0`; sessionStorage survives db-switch (not ref-namespaced). Every failure green-toasts. | DevPanel.tsx:602; rentals/new/page.tsx:1404,1456; accrue-payg-charges/index.ts:130–136 |
| 4 | **Fresh staging has no login identity** — wipe-and-build creates no auth user; `admin-create-user` yields head_admin (not super-admin); `emergency-bootstrap` hardcodes prod URL/uid. "Log in as super-admin" is impossible on the environment the design builds. | admin-create-user/index.ts:81,280,333 |
| 5 | **Phase-0 key rotation as written = production outage**: JWT-secret rotation kills the anon key + all sessions; prod anon key is hardcoded as client fallbacks in all apps; `.env.local.prod.bak` files restore dead keys later. | portal/booking client.ts:5–6; db-switch.mjs:26–40,80 |

## Majors (fix in v1)

6. **Double-fire double-charges** — `process-installment-payment` has no idempotency key/lock (PI created without idempotency key); `auto-extend-rentals` staggered double-fire defeats its UNIQUE via fresh MAX read. *Also a production race* if manual dispatch ever overlaps cron. → per-job advisory-lock lease in sim-control; fix flagged as prod-bug candidate.
7. **Both named safety flags are fictional** — `force_test_mode` and `NOTIFICATIONS_DISABLED` are read by ZERO lines in the repo (grep-verified). → preflight must assert the keys that actually neutralize (`!RESEND_API_KEY && !AWS_ACCESS_KEY_ID && !TWILIO_AUTH_TOKEN && !STRIPE_LIVE_SECRET_KEY`).
8. **Panel feedback is blind** — toast shows HTTP status only; catch-up cap (`maxDaysFor()`: 7/dispatch for 24h windows) makes +30d look broken after one fire; `functions.invoke` swallows non-2xx bodies (403/401/412 indistinguishable); invalidation list has 2 dead keys and misses actual PAYG keys. → parse response body, show processed/failed/capped, "fire again" hint, unfiltered invalidation, webhook-settle re-poll.
9. **PAYG shift incoherence** — shifting only `payg_next_accrual_at` leaves `payg_start_ts`/`start_date` at real-now → accruals dated before rental start; reminders always skipped; 4th +30d crosses `payg_max_duration_days` and permanently disables the fixture. → shift `[payg_next_accrual_at, payg_start_ts, start_date]` as a unit; fixture sets max-duration high.
10. **One-way transitions with no v1 reset** — `auto_extend_paused`, plan `overdue`, `collection_mode='manual'` can kill a fixture in one click with no indication. → `irreversible:[...]` per job in the manifest, rendered as a caution line.
11. **Anti-rot triple gap** — staleness stamp at sync (not deploy); no staleness display in panel; drift-checker has no trigger (no CI/husky). → stamp in deploy script; `list` returns sim_meta + deployed-sha shown next to Fire; `predev` warn-only drift hook.
12. **`recover-pending-stripe-payments` is anchored to REAL now** — `created_at` is a disqualifying column; backdating it silently excludes rows. → `shift()` refuses `payments.created_at`; document.
13. **`daily-reminders` buckets are exact midnight-UTC floor() math** — mid-day fires miss buckets; "due today" unreachable after 00:00 UTC (**prod bug candidate**). → shift↔bucket table documented.
14. **Multi-dev collisions on shared staging** — global fire sweeps the other dev's fixtures; wipe/sync are global nukes. → scenario-scope advisory lock; DB-artifact assertions scoped to own rental; `cleanupTenant()` instead of global wipe.

## Notable production bugs discovered by the audit (file separately)

- **`failure_count` can never organically exceed 1** — the plan SELECT omits `failure_count`, so `handleFailure`'s increment always writes 1 → the ≥3 overdue cascade is unreachable in production ([process-installment-payment/index.ts:47–54](../supabase/functions/process-installment-payment/index.ts) vs :202–206).
- **Double-charge race** in `process-installment-payment` (finding 6) exists in production whenever two dispatches overlap.
- **`daily-reminders` "due today" bucket unreachable** after 00:00 UTC (finding 13).
- `payment_intent.canceled` webhook handler cancels rentals with **no status guard** (stripe-webhook-test:1243–1277).

## Minors (documented limitations)

15. `failure_count` bug (above) — masked if scenarios only seed `=3`; add an organic-path assertion.
16. `refresh-deposit-holds` re-anchors expiry to real Stripe `capture_before` on every refresh — shift-then-fire self-reverts (expected; document).
17. Stripe Sandbox delivers delayed events up to 7 real days (`checkout.session.expired` ~24h; PI auto-cancel at 7d) → fixtures are same-day disposable; teardown cancels own PIs.
18. Auto-extend `awaiting_payment → paid → unpark` branch is headlessly unreachable (no API to complete hosted Checkout; manual settle forbidden by project rule) — documented gap.
19. Timeline coherence is PAYG-only — installment/auto-extend payments stamp real-now dates; key assertions to `installment_number`/`extension_id`, not dates.
20. `platform_verify_secret` is a data-backed DB RPC, not an env var — both docs' env lists were wrong.
21. Portal localhost falls back to hardcoded slug `drive-247` — staging fixture must create/assert that tenant.
22. Repo pins `supabase@^0.5.0` (no `functions` subcommand) — bump to `^2` or use the Management API for function download.
23. Auto-extend overrides/exceptions keyed by exact `end_date` strings — set them after the final shift.
24. Base design's "7 days/dispatch" is stale vs HEAD — it's tenant-aware `maxDaysFor()` (up to 300/dispatch for short windows); scenarios must assert final DB state, never dispatch counts.

## Binding amendments

**To CRON_SIM_DEVPANEL_SPEC.md:** A1 harden `sim_shift` (column allowlist from manifest, REVOKE from PUBLIC/anon/authenticated + GRANT service_role, row-count check, ±3650 bound, staging sentinel via `sim_meta`); A2 identity via `auth_user_id`; A3 `dev:lastRentalId:<projectRef>` written in rentals/new submit-success + target-eligibility warning from sim-control; A4 delete `force_test_mode`, preflight asserts absent side-effect keys; A5 response-body toasts + unfiltered invalidation + webhook re-poll; A6 payg driveCols as coherent unit + `irreversible` cautions; A7 per-job advisory-lock lease (409 when held) + scenario-scope lock; A8 deployed-sha line + grey out undeployed jobs.

**To CRON_SIMULATION_TESTING_DESIGN.md:** B1 rotation sequencing (prefer granular `sb_secret_` key migration; else update Vercel/env/fallbacks/delete `.bak` → redeploy → rotate → re-schedule cron); B2 `createStaffUser({superAdmin:true})` + `drive-247` tenant fixture; B3 stamp-at-deploy + schema-dump (not repo-push) + manifest-column validation + `predev` warn-only drift hook; B4 correct the `--twice` guard claims (PAYG-only) and `maxDaysFor()`; B5 §3.3 documentation rows (recover-pending, daily-reminders buckets, deposits re-anchor, Sandbox delayed events, unpark gap, coherence scope); B6 `platform_verify_secret` correction, CLI bump, `cleanupTenant()` primitive, shared-staging rules.

## Revised effort

| | Original | Revised |
|---|---|---|
| Phase 0 | ~2 pd | ~2.75 pd |
| Harness (Ph 1–2) | ~5 pd | ~5.75 pd |
| DevPanel v1 | ~3 pd | ~4.5 pd |
| **Total** | **~8.5 pd** | **~11 pd** |
