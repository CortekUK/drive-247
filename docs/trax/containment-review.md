# Containment for immediate review — Drive247 production database

**For:** the Drive247 administrator responsible for the Supabase project.
**Decision asked:** approve or decline two small, independent privilege changes — **Stage 0a** and **Stage 0b**. Nothing else in `docs/trax/remediation/` is part of this decision.
**Status:** not applied. No statement below has been run against any database. No customer, rental or payment record was created, changed or deleted to produce this evidence.

---

## 1. The decision in one page

| | Stage 0a | Stage 0b |
|---|---|---|
| File | [`remediation/00-revoke-anon-execute-on-definer-functions.sql`](remediation/00-revoke-anon-execute-on-definer-functions.sql) | [`remediation/01-revoke-destructive-anon-grants.sql`](remediation/01-revoke-destructive-anon-grants.sql) |
| What it removes | `EXECUTE` on 147 `SECURITY DEFINER` functions, from `anon` and `PUBLIC` | `DELETE` on 7 tables and `TRUNCATE` on 9 tables, from `anon`; `TRUNCATE` from `authenticated` |
| Statements | 148 `revoke` | 3 `revoke` |
| Why now | The published key can run arbitrary SQL as the database owner via `public.exec_sql` | The published key can delete or empty financial tables |
| Known dependency | none found (§4) | none for these tables (§4) |
| Reversible | yes, per function, in one statement | yes, per table, in one statement |
| Target | project `hviqoaokxvlancmftwuo`, region `eu-west-2` | same |

**Recommendation: approve 0a immediately, separately from everything else.** It is the only finding in this review where the public key grants control of the database rather than access to data.

---

## 2. Why 0a is the urgent one

The project's PostgREST configuration exposes the `public` schema (`db_schema: "public,graphql_public"`, read from the Management API on 2026-09-18). Every function the `anon` role may execute is therefore an HTTP endpoint at `/rest/v1/rpc/<name>`, callable by anyone holding the anon key — which is published in the website and portal JavaScript (`apps/booking/src/integrations/supabase/client.ts:19`).

150 functions in `public` are `SECURITY DEFINER`. They run as their owner, `postgres`. Row-level security does not apply to them, so **nothing in stages 1–4 constrains them**.

The one that decides the urgency:

```
public.exec_sql(query text)
  owner:    postgres
  security: DEFINER
  config:   search_path NOT SET
  acl:      {postgres=X/postgres, anon=X/postgres, service_role=X/postgres}
  body:     BEGIN EXECUTE query; END
```

An `EXECUTE` grant to `anon` on a function whose body is `EXECUTE query` is arbitrary SQL as the owner: read any table, write any row, change the schema, grant roles. The repository already recorded this as a known problem — `docs/CRON_SIMULATION_TESTING_DESIGN.md` lists "drop `exec_sql`" under footgun cleanup.

Others in the same set, for scale:

| Function | What an anonymous caller could do |
|---|---|
| `admin_revoke_user_sessions(text[])` | delete any user's `auth.sessions` and refresh tokens |
| `app_login(text, text)` | probe the legacy username/password login without rate limiting |
| `add_credits(...)` / `deduct_credits(...)` | move platform credit balances for any tenant |
| `approve_payment`, `apply_payment`, `apply_payment_fully`, `reject_payment` | change payment state |
| `block_customer`, `unblock_customer`, `dispose_vehicle`, `cancel_installment_plan` | change business records |
| `get_customer_statement`, `get_customer_balance_with_status`, `get_chat_history(p_tenant_id, …)` | read another tenant's data by passing its id |

18 of the 150 take a `tenant_id` argument, so the tenant is chosen by the caller.

**The grants are deliberate, not a PostgreSQL default.** 148 carry `anon=X/postgres` in their ACL — the signature of `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon`. The other two, `block_customer` and `unblock_customer`, are reachable through a `PUBLIC` grant (`{=X/postgres,…}`), which a revoke from `anon` alone would not close — so every statement in 0a revokes from both grantees.

---

## 3. Effective permissions, before and after

Measured with `has_table_privilege` / `has_function_privilege`, which account for `PUBLIC` grants and role membership, not only grants attached to `anon` directly. Role attributes were checked: `anon` and `authenticated` are members of nothing, have `rolinherit = true`, `rolbypassrls = false`; `service_role` has `rolbypassrls = true`; `authenticator` is a member of all three with `rolinherit = false` (it switches role per request, which is the normal Supabase arrangement).

### Stage 0a — functions

| Caller | Before | After 0a |
|---|---|---|
| `anon` — `exec_sql` | EXECUTE | **none** |
| `anon` — other 146 definer functions | EXECUTE | **none** |
| `PUBLIC` — `exec_sql`, `block_customer`, `unblock_customer` | EXECUTE | **none** |
| `anon` — `add_credits` ×2, `deduct_credits` | EXECUTE | EXECUTE (group B, §5) |
| `anon` — `generate_first_charge_for_rental`, `backfill_rental_charges_first_month_only` | EXECUTE | EXECUTE (unchanged — not definer, and the checkout calls them) |
| `authenticated` — all of the above | EXECUTE | EXECUTE (unchanged) |
| `service_role` — all of the above | EXECUTE | EXECUTE (unchanged) |

### Stage 0b — tables

| Table | `anon` before | `anon` after | `authenticated` after |
|---|---|---|---|
| payments, invoices, ledger_entries, payment_applications, payg_accruals, rental_extensions, vehicles | S I U D T | S I U | S I U D (no T) |
| customers, rentals | S I U D T | S I U **D** | S I U D (no T) |

`S`=SELECT `I`=INSERT `U`=UPDATE `D`=DELETE `T`=TRUNCATE.

`customers` and `rentals` keep `DELETE` deliberately — see §4. `DELETE` and `TRUNCATE` cannot be granted per column, so the table-level revoke is complete for them. **`INSERT`, `UPDATE`, `SELECT` and `REFERENCES` are also held at column level** by `anon` on these tables (44 columns on `customers`, 22 on `invoices`, 16 on `ledger_entries`, …). Stage 2 must revoke those column grants as well or the writes will keep working after a table-level revoke.

---

## 4. Evidence that nothing legitimate depends on this

Method: every `.rpc(` call and every `.delete()` call in `apps/` and `supabase/` was listed and classified by which client performs it — the browser (`anon`, or `authenticated` after sign-in) or server code (`service_role`).

**Stage 0a**

- The anonymous booking path calls exactly two RPCs: `generate_first_charge_for_rental` (`apps/booking/src/components/BookingCheckoutStep.tsx:1286`) and `backfill_rental_charges_first_month_only` (`apps/booking/src/app/booking/checkout/page.tsx:839`). Neither is `SECURITY DEFINER`, so neither appears in 0a.
- Portal and admin RPC calls — `block_customer`, `approve_payment`, `dispose_vehicle`, `cancel_installment_plan`, `swap_rental_vehicle`, `payg_settle_invoice` and the rest — run in a signed-in staff session as `authenticated`. 0a does not touch that grant.
- `exec_sql` is called only by `supabase/functions/simulate-payg-timelapse/index.ts`; `admin_revoke_user_sessions` only by `supabase/functions/admin-force-logout/index.ts`. Edge functions use the service role, which keeps its grant. That edge function's own error text says `GRANT EXECUTE ON FUNCTION exec_sql TO service_role`.
- `app_login` is called by no application code. Its grant comes from `supabase/migrations/20251219083413_remote_schema.sql:8462`.

**Stage 0b**

Two browser `DELETE` paths exist, and an earlier version of this file wrongly said there were none:

- `apps/booking/src/app/booking-cancelled/page.tsx:39` — deletes the `rentals` row after a failed checkout payment, then sets the vehicle back to `Available`.
- `apps/booking/src/components/BookingCheckoutStep.tsx:1365` — deletes the placeholder `customers` row (`email like 'pending-%@temp.booking'`).

Both run as `anon`. Revoking `DELETE` on those two tables now would leave abandoned rentals holding vehicle availability, so they are excluded from 0b and move with the stage 2 endpoint. Neither path deletes any of the other seven tables. The customer portal's deletes are on `customer_documents`, `customer_notifications` and `gig_driver_images` — not in 0b, handled in stage 3.

Note that these two cleanup paths are themselves part of the exposure: with the published key, anyone can delete any rental by id, and the `tenant_id` filter those pages add is supplied by the browser, so it is not a boundary.

**Server routes that could run as `anon`.** `apps/booking/src/app/api/esign/route.ts:32` and the portal equivalents build their client as `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY`. If the service key is missing in a deployment, those routes run as `anon`. None of them performs a `DELETE`, so 0b is unaffected; but they do call `add_credits`/`deduct_credits`, which is why those three functions are held back into group B until the environment variable is confirmed.

---

## 5. What is deliberately left open, and what remains after each stage

| After | Still open |
|---|---|
| **0a** | every anonymous read, insert and update in the finding; RLS still off on 61 tenant tables; 16 owner-rights views still readable by `anon`; `add_credits`/`deduct_credits` still anon-callable; `exec_sql` still exists for `service_role` |
| **0b** | all reads; all inserts and updates; `DELETE` on `customers` and `rentals`; everything above except the destructive privileges named |
| **Stage 1** (`02-…`) | anonymous **inserts** into customers/rentals/invoices/ledger_entries; column-level write grants; the other 54 exposed tables; the views |
| **Stage 3** (`03-…`) | anonymous inserts; the views; the two flagged decisions (`customer_notifications` has no customer link column; the checkout publishes the identity block list) |
| **Stage 4** (`04-…`) | anonymous inserts and the column grants — i.e. fabricated records remain possible until stage 2 |
| **Stage 2** | nothing in this finding, once the column grants are revoked with it |

Stage 1 must not be described as complete tenant isolation. It closes cross-tenant **reading**; it leaves a material write bypass open by design, and stage 2 is what closes it.

---

## 6. Verification, and what to do if something breaks

**Isolated tests, run against a throwaway Postgres** (`node tests/trax/...`, all passing):

| Suite | Result | What it establishes |
|---|---|---|
| `function-grants.mjs` | 6/6 | Stage 0a's 148 statements each resolve to a real function signature; afterwards `anon` and `PUBLIC` can execute none of the 147; the two checkout RPCs still work; `authenticated` and `service_role` keep everything; the rollback restores the exact prior ACLs |
| `remediation-sql.mjs` | 4/4 | Stage 0b leaves `DELETE` only on `customers`/`rentals`, removes `TRUNCATE` from both roles everywhere, and touches no read or insert grant |
| `tenant-isolation.mjs` | 12/12 | stages 0–4 applied to a two-tenant database, asserted as `anon`, staff of each account, a customer, a platform admin and `service_role` |

**Live verification after applying** — the queries are at the foot of each SQL file. In short: the definer-function count for `anon` goes from 150 to 3; the two checkout RPCs stay `true`; `authenticated` is unchanged.

**If something breaks:** re-grant the one function or table named in the incident, not the whole rollback file.

```sql
-- example, one function, one statement
grant execute on function public.<name>(<args>) to anon;
```

`06-rollback-function-revokes.sql` and `99-rollback.sql` exist for isolated testing. They restore the exposure wholesale and are **not** the operational recovery plan — see [`recovery-plan.md`](recovery-plan.md), which also records that point-in-time recovery is **disabled** on this project, so a restore would lose up to a day of bookings.

**Do not** prove the write exposure against production. The evidence above is catalogue metadata and code, and it is sufficient; a demonstration would create or destroy real records. Existing Supabase logs should be preserved for the period covered by the exposure before any retention window passes.
