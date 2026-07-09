# sim-control — cron simulation control plane (STAGING ONLY)

Powers the DevPanel **Time Machine** section and the `scripts/sim/*` terminal harness.
Lets a developer fast-forward a rental's timeline and fire the real cron jobs against
**staging**, so time-dependent features (PAYG, installments, auto-extension, reminders,
deposits) can be tested end-to-end in seconds instead of waiting real days.

## How it works

The cron functions decide "is it time?" by comparing `now()` to a stored timestamp
column. So we don't fake the clock — we **backdate the driving column** (`shift`) and
then **dispatch the real cron function** (`fire`). One `shift` + a few `fire`s = N days
simulated.

```
Browser DevPanel  ─(super-admin JWT)─┐
scripts/sim/*.mjs ─(service key)──────┤→  sim-control (staging only)
                                      │      guard1: allowlist staging ref → else 403
                                      │      guard2: super-admin JWT or service key
                                      │      guard3: no live-stripe tenants + no side-effect keys → else 412
                                      │      shift → sim_shift RPC (allow-listed cols)
                                      │      fire  → POST real cron fn / call sql rpc
```

## Files
- `index.ts` — the edge function (3 fail-closed guards + list/shift/fire).
- `manifests.ts` + `cron-manifest.json` + `sim-shift-manifest.json` — single source of truth for job → target and domain → driving columns.
- `sim_shift.sql` — the staging-only backdate RPC (allow-lists tables **and** columns, refuses without the `sim_meta` staging sentinel).

## Safety model (why this cannot touch production)
1. **Render gate** — the DevPanel only mounts under `NODE_ENV==='development'`.
2. **Client badge** — the panel shows red **PROD** and disables all controls when `NEXT_PUBLIC_SUPABASE_URL` is the prod ref.
3. **Function allowlist (authoritative)** — `sim-control` 403s unless its own `SUPABASE_URL` is the staging ref. Inert even if mis-deployed to prod.
4. **RPC sentinel (authoritative)** — `sim_shift` raises unless `public.sim_meta` has a `staging` row, which exists only on staging. Inert even if the SQL is mis-applied to prod.
5. **Sandbox preflight** — every state change is blocked (412) unless staging has zero `stripe_mode='live'` tenants and none of the side-effect keys (`RESEND_API_KEY`, `AWS_ACCESS_KEY_ID`, `TWILIO_AUTH_TOKEN`, `STRIPE_LIVE_SECRET_KEY`) are set.
6. **Harness sentinel** — `scripts/sim/helpers.mjs` throws unless `SIM_STAGING_URL` is the staging ref.

## Deploy (STAGING ONLY — do NOT deploy to production)

> These steps require the staging project to exist and be seeded, and staging
> service credentials. Run them against `ksmreaadhbirzakkxqrq` only.

```bash
# 1. Apply the staging sentinel + shift RPC to STAGING (never prod):
#    psql "$STAGING_DB_URL" -f supabase/functions/sim-control/sim_shift.sql
#    insert into public.sim_meta(key,value) values ('staging','1') on conflict do nothing;

# 2. config.toml must contain:  [functions.sim-control]  verify_jwt = true

# 3. Deploy ONLY to staging:
#    supabase functions deploy sim-control --project-ref ksmreaadhbirzakkxqrq

# 4. Never add sim-control to a prod deploy target. (Guard 1 makes it inert there anyway.)
```

## Use it
- **Panel:** `npm run db:switch staging` → `npm run dev:portal` → log in as super-admin → DevPanel → Time Machine.
- **Terminal:** `set -a; source .env.staging; set +a; node scripts/sim/scenario-payg-30-days.mjs <rentalId>`
