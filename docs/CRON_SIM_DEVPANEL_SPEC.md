# Time Machine — Cron Simulation in the Portal DevPanel (BUILDABLE SPEC)

> ⚠️ **AMENDED 2026-07-08:** a pre-build edge-case audit found 5 blockers in this spec as originally written (open `sim_shift` RPC, wrong identity column, broken golden path, no staging login identity, fictional safety flags). **Build against this spec + the binding amendments A1–A8 in [CRON_SIM_EDGE_CASE_AUDIT.md](CRON_SIM_EDGE_CASE_AUDIT.md).**

**Status:** Buildable *with audit amendments A1–A8*. Additive front-end over the terminal harness in [CRON_SIMULATION_TESTING_DESIGN.md](CRON_SIMULATION_TESTING_DESIGN.md) — same engine, friendlier surface.
**Date:** 2026-07-08 · Produced by multi-agent design (3 analyses → architect → safety+DX critique → finalize), all claims verified against the repo.

## What this adds

A new collapsible **"⏱ Time Machine / Cron"** section in the existing DevPanel ([DevPanel.tsx](../apps/portal/src/components/shared/DevPanel.tsx)) that lets a dev, from the browser:
- see a **STAGING (green) / PROD (red, disabled)** badge for the currently-pointed project,
- **jump a rental forward N days** (+1/+7/+14/+30),
- **fire any cron job** on demand from a dropdown,
- and watch the portal pages they're already debugging update in place.

The panel is a thin client. All privileged work happens in a **staging-only `sim-control` edge function** that holds service-role/cron secrets server-side and hard-refuses to run against production.

## Key design decisions (from the critique)

1. **No browser secret.** The original idea of a `NEXT_PUBLIC_SIM_CONTROL_SECRET` was a **ship-blocker** — Next.js inlines `NEXT_PUBLIC_*` into every deployed bundle (prod site included), so it can never be secret. Auth is instead the **logged-in super-admin's own JWT**, auto-attached by `supabase.functions.invoke`, verified server-side against `app_users.is_super_admin`. The terminal harness authenticates with the service-role key.
2. **Prod refusal is an allowlist, fail-closed.** `sim-control` runs only if its `SUPABASE_URL` includes the staging ref `ksmreaadhbirzakkxqrq`; anything else → 403. (Denylisting the prod ref would miss DR/new/per-tenant refs.)
3. **Sandbox preflight (hard 412).** Before any state change, the function asserts **zero tenants in `stripe_mode='live'`** and **`NOTIFICATIONS_DISABLED='true'`** on the target project. This is what makes v1 safe even though `fire` is global.
4. **Manifest-driven, harness-first.** The job list, shift columns, and auth types live in two root JSON manifests (`cron-manifest.json`, `sim-shift-manifest.json`) imported by both the edge function and the `.mjs` scripts — one source of truth, zero literals in the React component. The terminal harness ships first; the panel is the friendly layer.
5. **v1 is small:** `list` + `shift` + `fire` only. `status`/`reset`/`scenario`/live-readout are deferred (the real portal pages are the readout, via React Query invalidation).

## Architecture

```
DEV LAPTOP ONLY (npm run dev:portal → NODE_ENV==='development'; DevPanel mounts)
  Browser: <TimeMachineSection/>
    badge = NEXT_PUBLIC_SUPABASE_URL.includes(PROD_REF) ? 'PROD'(disabled) : 'STAGING'
    auth  = logged-in super-admin JWT (auto-attached)  ← NO secret in browser
    call  = supabase.functions.invoke('sim-control', { body:{action:'list'|'shift'|'fire'} })
        │  HTTPS → remote Supabase (must be STAGING)
        ▼
EDGE FN sim-control  (verify_jwt=true, deployed to STAGING only)
   ① ALLOWLIST: SUPABASE_URL must include staging ref, else 403   (fail-closed)
   ② IDENTITY : bearer === service-role key  OR  JWT → app_users.is_super_admin
   ③ SANDBOX  : 0 live-stripe tenants AND NOTIFICATIONS_DISABLED=true, else 412
   ④ createClient(URL, SERVICE_ROLE_KEY)   ← service-role & cron secrets live ONLY here
      list  → returns manifests (panel renders dropdowns from this)
      shift → RPC sim_shift(table,id,cols[],days)   (allow-listed cols; no free-form SQL)
      fire  → fetch $URL/functions/v1/<path> w/ correct auth + {force_test_mode:true}
            → OR svc.rpc(<sqlName>) for the 3 SQL-only jobs
        └── same cron-manifest.json + sim-shift-manifest.json ──> scripts/sim/*.mjs (ships first)
```

## Build pieces

### 1. `supabase/functions/sim-control/index.ts` (+ `manifests.ts`)
Single POST, dispatch on `body.action`. Guard order: CORS → allowlist(403) → identity(401/403) → for shift/fire: sandbox preflight(412) → action. config.toml:
```toml
[functions.sim-control]
verify_jwt = true
```
Staging-only env: `AUTOMATION_CRON_SECRET`, `PLATFORM_VERIFY_SECRET`, `NOTIFICATIONS_DISABLED=true` (service-role key auto-injected). Add `sim-control` to an explicit exclude in any "deploy all" script; even a mistaken prod deploy is inert (guard ①).

**Guard + action code:** see the finalized spec block below (verbatim, ready to paste).

### 2. `public.sim_shift(...)` RPC (bounded SECURITY DEFINER, applied via Supabase MCP — NOT the retired `exec_sql`)
```sql
create or replace function public.sim_shift(p_table text, p_id uuid, p_cols text[], p_days int)
returns void language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if p_table not in ('rentals','ledger_entries','scheduled_installments','installment_plans')
    then raise exception 'table % not allow-listed', p_table; end if;
  foreach c in array p_cols loop
    execute format('update %I set %I = %I - ($1||'' days'')::interval where id = $2', p_table, c, c)
      using p_days::text, p_id;
  end loop;
end $$;
```

### 3. `apps/portal/src/components/shared/TimeMachineSection.tsx` (new sibling file)
Extracted, not inlined (it's ~90 lines with real logic; the other 7 sections stay untouched). Wire into DevPanel with one import + one `<TimeMachineSection expanded={expandedSection==="sim"} onToggle={()=>toggleSection("sim")} />` before the Clear-All button (~line 1069). Env badge: `(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("hviqoaokxvlancmftwuo")`. Target rental from `sessionStorage['dev:lastRentalId']` (set it in the existing Create-Rental success path). Full component sketch in the finalized spec block below.

### 4. Manifests (root, shared)
- `cron-manifest.json` — `name → { path, authType, kind, rpc? }` (also the Phase-0 drift-check artifact from the base design).
- `sim-shift-manifest.json` — `domain → { table, driveCols[], oneshotFlags[], idField }`. v1 needs only `payg` (`rentals.payg_next_accrual_at` → fire `accrue-payg-charges`).

## v1 scope & effort (~5.5 person-days)

**Blocking Phase-0 prerequisites (safety):** delete `supabase/functions/simulate-payg-timelapse/`, `DROP FUNCTION public.exec_sql(text)` + redeploy; remove & rotate the committed staging keys in [db-switch.mjs:30](../scripts/db-switch.mjs#L30); assert staging is synthetic + `NOTIFICATIONS_DISABLED=true` + zero live-stripe tenants.

Then: harness `scripts/sim/*.mjs` (~1.5pd) → `sim-control` list/shift/fire + guards + RPC (~2pd) → `<TimeMachineSection>` (~1pd).

**Deferred:** `status`/`reset`/`scenario` actions; canned scenarios (live in harness/manifests, printed to stdout); target-scoped fire (`only_rental_id`, to shrink blast radius); live-state readout; staleness banner.

## How a dev uses it
1. `npm run db:switch staging` → `npm run dev:portal`.
2. Log in as super-admin, open DevPanel → **Time Machine** shows green **STAGING**.
3. Use **Create Rental** to make a PAYG fixture (stores `dev:lastRentalId`).
4. Click **+30d** → `sim-control` backdates `payg_next_accrual_at`; pages refetch.
5. Pick `accrue-payg-charges` → **Fire**. Real cron runs (Stripe test-forced, notifications no-op); the ledger page updates in place; toast shows `→ 200`.
6. For multi-cycle sweeps, run the harness: `node scripts/sim/payg-timelapse.mjs`.

---

*(The finalized spec's exact `sim-control` guard code and `TimeMachineSection.tsx` sketch are preserved in the workflow output; paste them verbatim when implementing.)*
