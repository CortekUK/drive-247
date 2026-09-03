# V2_PLAN.md

How Drive247 is being rebuilt. If you are an AI agent picking up this work with
no other context, read this file first and in order.

Every number in this document was measured against production on 2026-09-03. Where
a number matters, the query that produced it is in `scripts/v1-check/shared.mjs`.

---

## 0. Read this before you write a single line

Two things will cause real damage faster than anything else you can do here.

**One — there is no staging.** You are working on `main`, in the repo that
deploys, against the production database that ~32 paying operators are running
their businesses on right now. There is no branch between you and them. A
migration you apply is applied to their data. An edge function you redeploy is
serving their customers within seconds.

**Two — the database will not stop you from reading or writing another
operator's data.** Row Level Security is **disabled on the core tables**.
Isolation is enforced *only* by application code putting `tenant_id` in the
query. See §5. Treat a missing `tenant_id` filter as a critical bug, always,
without exception.

---

## 1. What v2 is, and why it is not a rewrite

Drive247 is a live multi-tenant car-rental SaaS. v2 is a rebuild of the UI, a
simplification of the flows behind it, and eventually a move off direct Supabase
access onto an owned API layer.

It is being done **incrementally, on `main`, with no long-lived branch.**

That constraint is not a preference. It was learned. A previous `staging` branch
was allowed to run ahead of `main` and diverged past any hope of merging —
`git diff --shortstat main origin/staging` currently reports **1,420 files
changed, 333,232 deletions**. It can never be merged back; the work in it is
stranded. A branch that lives long enough to be worth merging has already grown
too far apart to merge.

So the model is:

- All work lands on `main`.
- Every change is behind a tenant gate.
- A single canary tenant, **`northwind`**, receives every change first — UI,
  logic, schema, architecture.
- The other 56 tenants — 32 of them paying — continue to see v1, untouched,
  with no code path changed underneath them.
- v2 grows over v1 one area at a time. When an area is live for every tenant,
  the v1 code for that area is deleted and its gate is removed.
- v1 is switched off only when nothing is left pointing at it.

The canary is a real tenant row:

```
slug          northwind
id            6e5c544f-b374-451f-a662-360a634bff15
name          Northwind Rentals
tenant_type   test
login         ilyasghulam35@gmail.com
created       2026-09-03
```

It lives in production, alongside the real operators — not in a copy of the
database, because a copy is a second thing to keep in sync and it stops
resembling production the day it is made.

It carries synthetic data only. Never copy real customer data into it.

---

## 2. The canary model

There is no rollout system. There is one tenant.

Every v2 change — a screen, a query, a column, a trigger, an edge function —
is gated so that **`northwind` sees it and nobody else does**. The other 56
tenants keep running exactly the code they ran yesterday. When a change has
been live on the canary long enough to have failed and has not, it is widened;
when it is live for everyone, the v1 code behind it is deleted and the gate
goes with it.

That is the whole model. **No rollout table, no rollout percentage, no admin UI,
nothing in the database that describes a rollout.** Machinery of that kind was
built here and then removed deliberately. It is a second system that has to stay
correct, and one that is subtly wrong is worse than none at all: it tells you a
change can be pulled back at the exact moment you are betting on being able to
pull it back.

### Where the gate lives

**In application code, keyed on the tenant.** Resolve the tenant, ask whether it
is on v2 for this area, render v2 or v1.

```ts
// apps/portal/src/lib/v2.ts   ← create this with the first v2 area
export const NORTHWIND = '6e5c544f-b374-451f-a662-360a634bff15';

/** One entry per v2 area. Today every list is just the canary. */
const V2_AREAS = {
  vehicles:  [NORTHWIND],
  dashboard: [NORTHWIND],
} satisfies Record<string, readonly string[]>;

export function isV2(
  area: keyof typeof V2_AREAS,
  tenantId: string | null | undefined,
): boolean {
  if (!tenantId) return false;          // unknown tenant ⇒ v1, always
  return V2_AREAS[area].includes(tenantId);
}
```

Widening an area is an edit to that one file and a deploy — reviewed like any
other change, reverted like any other change, and recorded in `git log`, which
is more history than a toggle in a dashboard ever gave. It needs no migration,
so the gate can never break v1's schema; it costs no query, so the gate can
never fail.

Three properties of it are not optional:

**It fails to v1.** If resolving the tenant throws, or comes back empty, the
answer is v1 and every tenant sees the screen they already had. A gate that
fails *open* puts all 57 tenants on unfinished code at once.

**It is resolved once, at the entrance** — on the server, at the route or layout
level. Never sprinkled through a component, never in a client effect. That is
§3, and it is the most important rule in this document.

**It is deletable.** When an area is live for everyone, the cleanup is deleting
its entry from `V2_AREAS` and its branch from the route. Nothing else.

The one gate that predates this file is the `tenants.booking_v2_enabled` column,
read by `apps/booking/src/app/page.tsx`. Copy its **shape** — resolved on the
server, in one place, falling back to the legacy component on any failure. Do
not copy its **storage**: new gates do not get a column on `tenants` (§4).

### Widening

Move one step at a time, and only when the previous step has been live long
enough to have failed:

```
northwind  →  1–2 real, friendly tenants  →  everyone
```

Do not skip to "everyone" because a change looks small. The changes that broke
things looked small.

### One area at a time — the rule with no database behind it

> **Two pieces of v2 work must not touch the same code at the same time.**

Independent rollback is the entire safety story of this project, and it only
holds while each change's edits are *separable*. If two pieces of work touch the
same screen at once, their edits land on the same lines and fuse. From then on:

- Reverting A also removes half of B, or breaks it outright.
- Reverting "just A" is no longer a thing that can be done.
- And the two gates still *look* independent — two entries in `V2_AREAS`, two
  things you believe you can pull separately. The belief is the dangerous part,
  and it holds right up until the incident in which you need it not to.

This used to be enforced by a unique index that refused the second claim on an
area. That index is gone, so the check is yours to make: before you start, look
at what else is in flight and confirm it does not touch the files you are about
to touch. If it does, split the area or wait. Two v2 areas may share a *route
tree*; they may not share a *file*.

---

## 3. The strangler rule

**This is the most important section in this document.**

> **Never edit an old screen in place. Build the new one as a separate
> route/file beside it, and put the `if` at the route or layout level.**

The old file keeps working, byte for byte, for the tenants still on it. The new
file is free to be whatever it needs to be. One branch, in one place, decides
which runs.

### Bad

```tsx
// apps/portal/src/app/(dashboard)/vehicles/page.tsx
export default function VehiclesPage() {
  const { tenant } = useTenant();
  const v2 = isV2('vehicles', tenant?.id);

  return (
    <div className={v2 ? 'grid-cols-3' : 'grid-cols-2'}>
      {v2 ? <NewFilterBar /> : <FilterBar />}
      {rows.map((r) => (v2 ? <NewRow row={r} /> : <Row row={r} />))}
      {v2 && <NewBulkActions />}
    </div>
  );
}
```

Every `if` is a place v1 can break. The two designs are now welded into one
file that neither of them owns. And the gate can never be deleted — removing it
means unpicking a dozen conditionals by hand, in a file that is by then also
carrying bug fixes for both paths.

### Good

```tsx
// apps/portal/src/app/(dashboard)/vehicles/page.tsx   ← the ONLY edit to v1
import { isV2 } from '@/lib/v2';
import { tenantIdFromHeaders } from '@/lib/tenant-server';
import LegacyVehicles from '@/components/vehicles/legacy-vehicles';
import VehiclesV2 from '@/components/vehicles-v2/vehicles-v2';

export default async function VehiclesPage() {
  const tenantId = await tenantIdFromHeaders();   // never throws; null on failure
  return isV2('vehicles', tenantId) ? <VehiclesV2 /> : <LegacyVehicles />;
}
```

```
apps/portal/src/components/vehicles/        ← v1. Untouched. Deleted at the end.
apps/portal/src/components/vehicles-v2/     ← v2. Yours.
```

Neither `@/lib/v2` nor `@/lib/tenant-server` exists in `apps/portal` yet. Write
them once, with the first area, and every later route reuses them.

There is a working example of this already in the repo, from the booking-v2
landing page. Read it before you write your own:

- `apps/booking/src/app/page.tsx` — resolves the flag **on the server**, in one
  place, and falls back to the legacy component if the lookup throws.
- `apps/booking/src/app/booking-v2/page.tsx` — a standing preview route that
  renders the new design on *every* tenant regardless of the flag, so it can be
  reviewed without switching anyone over.

Note what that example does with failure:

```tsx
} catch {
  // Never let a flag lookup take the home page down — fall back to the
  // design every tenant already has.
  return false;
}
```

**A gate that throws must resolve to v1.** If resolving the tenant fails, every
tenant gets the screen they already had. If it fails open to v2, one bad query
puts every tenant on unfinished code at once.

Resolve the gate on the **server**, not in a client effect. A client-side
resolve either blanks the page for everyone while the tenant loads, or paints v1
and swaps — which reads as a broken page on exactly the tenants you switched on.

### Why this is the rule

Separate files are what make the gate **deletable**. At the end of an area's
life the cleanup is: delete the v1 directory, delete the branch in the route,
delete the entry in `V2_AREAS`. Three deletions, no judgement calls. That is
only true if nothing v2 wrote ever went inside a v1 file.

The alternative — flags sprinkled through components — is how a codebase
accumulates flags that can never be removed, and how a "temporary" migration
becomes permanent.

---

## 4. Database rules — additive only

**v1 and v2 share ONE production database.** There is no second database and no
migration window. Every schema change must leave v1 working unchanged.

### Allowed

| ✅ | Why it is safe |
|---|---|
| New table | v1 does not know it exists |
| New **nullable** column, or one with a default | v1's existing `INSERT`s, which never mention it, still succeed |
| New **non-unique** index | changes plans, never results |
| New function | nothing calls it yet |
| New RLS policy on a table you added | v1 never touches it |

### Forbidden

| ❌ | What breaks |
|---|---|
| Drop a table or column | every v1 read of it, immediately |
| Rename anything | same as a drop, with a decoy |
| Change a column's type | v1's writes start failing, or silently coerce |
| Add `NOT NULL` to an existing column | every v1 `INSERT` that omits it |
| Remove a default | same |
| Add a `UNIQUE` constraint over existing data | fails on the data already there, or rejects tomorrow's legitimate duplicate |
| Change a function's signature | every existing caller, including edge functions you did not think to grep |

If you genuinely need a column to change shape: **add the new column beside the
old one**, write to both, migrate readers one area at a time, and drop the old
column only after v1 is switched off. That is the same strangler pattern, one
level down.

### The `tenants`-table grant trap

`public.tenants` is a special case that has already bitten this codebase.

`anon` does **not** hold a table-level `SELECT` on `tenants`. It holds
**242 column-level `SELECT` grants**. Postgres refuses the **whole row** for any
select that mentions a column the role cannot see — so a new column on `tenants`
is not merely invisible to the anon key, it makes the booking site's entire
`TenantContext` query fail, and *every tenant silently loses its branding*, not
just the flag you added.

Any new column on `public.tenants` needs:

```sql
GRANT SELECT (your_new_column) ON public.tenants TO anon;
```

`authenticated` already has a table-level `SELECT` and needs nothing.
See `supabase/migrations/20260820150000_add_booking_v2_flag.sql`, which
documents this in place.

### Do not add flag #74

`public.tenants` currently has **269 columns, 73 of them boolean**. Many are
orphaned — flags for features that shipped, were removed, or were never
finished, still being selected on every tenant load.

**New feature flags do not go on `tenants`.** The next boolean here is #74. It
would be selected on every tenant load forever, it would need its own `anon`
grant or it takes every booking site down on the day it lands, and it would
outlive the feature it was added for exactly the way the orphans above did.

v2 gates live in application code instead (§2), keyed on the tenant id. They
cost no column, no grant, no migration and no query — and deleting one is
deleting a line.

---

## 5. ⚠️ TENANT ISOLATION — there is no database-level net

**Read this twice.**

RLS is **disabled** on the tables the entire business runs on:

```
rentals          RLS OFF   (11 policies defined — all inert)
customers        RLS OFF   (15 policies defined — all inert)
payments         RLS OFF   (10 policies defined — all inert)
vehicles         RLS OFF   (10 policies defined — all inert)
invoices         RLS OFF   ( 8 policies defined — all inert)
ledger_entries   RLS OFF   ( 0 policies)
app_users        RLS OFF   ( 5 policies defined — all inert)
```

**74 of 220 public tables have RLS disabled overall.**

Note the second column. Six of those seven tables have policies written on
them. **Policies on a table with RLS disabled do not run.** They are visible in
the Supabase dashboard, they look like protection, and they enforce absolutely
nothing. Do not read the presence of a policy as evidence that a table is
protected. Check `pg_class.relrowsecurity`, which is what `npm run v1:check`
reports for you.

### What this means for every query you write

**Tenant isolation is enforced ONLY in application code. Every single query must
filter by `tenant_id`.**

```ts
// WRONG — returns every operator's rentals on the platform
const { data } = await supabase.from('rentals').select('*').eq('status', 'active');

// RIGHT
const { data } = await supabase
  .from('rentals')
  .select('*')
  .eq('tenant_id', tenant.id)     // ← the only thing standing between tenants
  .eq('status', 'active');
```

The same applies to `update` and `delete`, where the consequence is worse: a
missing `tenant_id` in a `WHERE` clause writes to another paying customer's live
data.

Edge functions using the `service_role` key bypass everything by design. They
must resolve `tenant_id` explicitly and filter on it themselves.

### Is this being fixed?

**This is a known, accepted gap.** The owner has deliberately chosen to handle
isolation at the application layer for now and will revisit enabling RLS as a
separate, considered piece of work. It is not an oversight you have discovered,
and turning RLS on is **not** something to do opportunistically while you are in
the area — flipping it on a table with inert policies would take v1 down for
every tenant at once.

So: do not enable RLS. Do not treat the `RLS` section of `v1:check` as a
failure. **Do** treat a missing `tenant_id` filter, in any code you write or
review, as a critical bug — the highest-severity kind, on par with a data loss
bug — because with no net beneath it, that is exactly what it is.

---

## 6. Triggers — the case that slips past review

Adding a trigger to an existing table is **schema-additive and behaviourally
breaking at the same time.** `CREATE TRIGGER` alters no column, so it passes a
"did you change any columns?" review — and then it changes what happens every
time v1 writes a row.

There are **181 triggers** on public tables today. Two real ones show both
shapes of the problem:

**`queue_for_rag()`** — attached to `rentals`, `payments`, `customers` and
`vehicles` as an `AFTER` trigger. Every insert, update and delete on any of those
tables writes a row into `rag_sync_queue`. It is `SECURITY DEFINER` and it
assumes `NEW.tenant_id` exists. A table without `tenant_id` wired into it would
fail on every write.

**`private.snapshot_rental_health()`** — `trg_snapshot_rental_health`, **`BEFORE
INSERT` on `rentals`**, and it contains **no exception handler** (verified: 3,481
characters of function body, zero `EXCEPTION` blocks). Anything that raises
inside it aborts the insert. The operator does not see "the health snapshot
failed" — they see **the rental fail to be created**, with an error that points
at the trigger's internals rather than at anything they did. This has already
happened once in this codebase, and it blocked rental creation for a whole class
of tenants.

### The rule

> Any new trigger on a pre-existing table must **branch on tenant** and requires
> explicit review before it is applied.

```sql
CREATE OR REPLACE FUNCTION public.my_v2_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- v1 tenants must leave this function having done nothing at all.
  IF NEW.tenant_id <> '6e5c544f-b374-451f-a662-360a634bff15'::uuid THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- v2 behaviour here
  EXCEPTION WHEN OTHERS THEN
    -- Never abort the caller's write for a side effect.
    RAISE WARNING 'my_v2_trigger: %', SQLERRM;
  END;

  RETURN NEW;
END $$;
```

Two things in that skeleton are non-negotiable: the tenant guard comes **first**,
and anything that can raise is wrapped. Prefer `AFTER` over `BEFORE` whenever the
trigger does not need to modify the row — an `AFTER` trigger that fails still
rolls the statement back, but it cannot mangle the row on its way through.

`npm run v1:check` reports **any** new trigger on a pre-existing table as
BREAKING, deliberately, including correct ones. When you have written and
reviewed one, re-run `npm run v1:snapshot` and commit the new baseline together
with the migration and the reason.

---

## 7. Edge functions

There are **324 edge functions** in `supabase/functions/`, **67** of them with
`verify_jwt = false` in `supabase/config.toml` — publicly callable without a JWT
(third-party webhooks that verify their own signatures, cron targets, and a few
genuinely public endpoints).

> **Never change the behaviour of an existing edge function.**

They are shared by every tenant, they are deployed independently of the frontend,
and several are called by Stripe, BoldSign, Twilio and pg_cron rather than by
your code — so "who calls this?" cannot be answered by grepping the repo.

Instead:

```
supabase/functions/create-checkout-session/       ← v1. Untouched.
supabase/functions/create-checkout-session-v2/    ← v2. Point northwind at it.
```

The caller picks, the same way a route picks a component:

```ts
const fn = isV2('checkout', tenant.id)
  ? 'create-checkout-session-v2'
  : 'create-checkout-session';
await supabase.functions.invoke(fn, { body });
```

Shared helpers in `supabase/functions/_shared/` are used by dozens of functions
at once (`cors.ts`, `stripe-client.ts`, `boldsign-client.ts`,
`email-template-service.ts`, …). Editing one of those is editing every function
that imports it. **Add a new helper; do not change an existing one.**

If a v2 function needs a webhook, give it its own endpoint and its own signing
secret. Do not add a branch to `stripe-webhook-live`.

---

## 8. The guardrail — `npm run v1:check`

```bash
SUPABASE_ACCESS_TOKEN=sbp_... npm run v1:check
```

Run it **before you start** a change and **after you finish** one. It re-reads
production, compares it to `scripts/v1-check/baseline.json`, and exits non-zero
if v1 has moved. Everything it does is a `SELECT`; it never writes.

The token is read from the environment and is deliberately **not stored in this
repo** — it is a Supabase *Management* token, it can delete any project on the
account, and this repo is pushed to GitHub, where git history outlives a
rotation.

### What each section means

| Section | Reports | Verdict |
|---|---|---|
| `SCHEMA` | every schema difference, classified against §4 | ADDITIVE or **BREAKING** |
| `TRIGGERS` | new/dropped/altered triggers; a new one on a pre-existing table | **BREAKING** |
| `EDGE FNS` | any v1 function directory whose contents changed | **BREAKING** |
| `V1 FILES` | any file in the v1 manifest whose contents changed | WARN — never fails the run |
| `SMOKE` | 7 read-only queries proving v1's core still answers | **BREAKING** if any fails |
| `RLS` | how many core tables have RLS off | NOTE — informational, never fails |

New files and new tables are **not** findings. A new file beside an old one is
the strangler pattern working exactly as intended.

The smoke set was 9 checks until the admin rollout feature was withdrawn: the
two that asserted its tables and its function went with it, from both the repo
and the database, and the baseline was re-snapshotted in that commit. That is
also why the baseline counts below are a little lower than they were.

### When something fails

**SCHEMA / TRIGGERS — BREAKING.** Read the classification against §4. If it is
genuinely forbidden, revert the migration. If it is additive but the script
flagged it (a new tenant-guarded trigger is the usual case), get it reviewed,
then re-snapshot.

**EDGE FNS — BREAKING.** You edited a v1 function. Revert it and add `-v2`
instead (§7). The only legitimate reason to accept this is a real v1 production
bug fix.

**V1 FILES — WARN.** A warning, not a failure, because some edits to v1 files
are expected: a real v1 bug fix, or the one-line branch at the top of a route
that hands off to the v2 screen (§3). The rule of thumb: **if a file is listed
here, you should be able to say why in one sentence.** If the sentence is "while
I was in there I also tidied up the old component", revert it.

**SMOKE — BREAKING.** v1's core has actually stopped answering. Stop and fix
this before anything else.

**RLS — NOTE.** Never a failure. See §5. Do not "fix" it.

### Re-baselining

```bash
SUPABASE_ACCESS_TOKEN=sbp_... npm run v1:snapshot
```

Only after a change you have decided is correct, and then **commit the new
`baseline.json` in the same commit as the change, with the reason in the message.**

Re-running the snapshot to silence a failing check is the one way to make this
whole directory worthless. The baseline is the record of what was agreed; a
baseline regenerated whenever it complains records nothing.

The current baseline covers 220 tables, 3,297 columns, 1,148 constraints, 893
indexes, 550 function signatures, 181 triggers, 324 edge functions and 1,930 v1
source files.

---

## 9. Reference — facts an agent needs

**Production Supabase**

```
project ref   hviqoaokxvlancmftwuo
tables        220 public   (74 without RLS)
functions     550 public
triggers      181 public
edge fns      324  (67 with verify_jwt = false)
tenants       57 rows      (32 with an active/trialing/past_due subscription)
```

RLS helper functions, still used by the 146 tables that do have RLS on:
`get_user_tenant_id()`, `is_super_admin()`, `is_primary_super_admin()`,
`is_global_master_admin()`. Super admins have `tenant_id = NULL` in `app_users`,
which is a live source of bugs in any edge function that reads
`appUser.tenant_id` without handling null.

**The apps**

Five, not four. `apps/bonzah` is a real fifth app (the Bonzah partner console).

| App | Purpose | `.from('…')` call sites |
|---|---|---|
| `apps/portal` | operator admin portal | 1,319 |
| `apps/booking` | customer booking + customer portal | 351 |
| `apps/admin` | super-admin dashboard | 179 |
| `apps/web` | marketing site | 7 |
| `apps/bonzah` | Bonzah partner console | 4 |
| | **total** | **1,860** |

Those 1,860 direct `.from()` calls **are the Supabase coupling.** They are what
the future owned API layer replaces, and the reason the move off Supabase is a
later phase rather than this one. Do not add to the pile casually: new v2 data
access should go through a hook or a service function, not a raw `.from()`
inline in a component, so that there is one place to change later.

**TypeScript strictness varies per app.** Code moved between apps will not
compile the same way.

| App | `strict` | `strictNullChecks` | `ignoreBuildErrors` |
|---|---|---|---|
| `apps/admin` | **true** | true | **false** — type errors fail the build |
| `apps/web` | true | true | — |
| `apps/bonzah` | true | true | — |
| `apps/booking` | false | **true** | true |
| `apps/portal` | false | **false** | true |

`apps/admin` is the strict one: `strict: true` and no `ignoreBuildErrors`, so a
type error there fails the build instead of shipping. `apps/portal` is the loose
one — `strictNullChecks: false` — so code that compiles there will not
necessarily compile anywhere else, and a null it tolerated becomes a build
failure the moment it moves.

**Multi-tenancy resolution.** Portal: `{tenant}.portal.drive-247.com`. Booking:
`{tenant}.drive-247.com`. Both extract the slug from the subdomain and inject an
`x-tenant-slug` header — but **in different files**: booking uses
`apps/booking/src/middleware.ts`, portal uses `apps/portal/src/proxy.ts`
(Next.js 16 renamed the hook; `CLAUDE.md` still says `middleware.ts` for portal
and is wrong). Reserved subdomains that are *not* tenant slugs: `www`, `admin`,
`portal`, `api`, `app`.

**Generated types.** After any schema change, regenerate and copy to every app:

```bash
npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo \
  > apps/portal/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/admin/src/integrations/supabase/types.ts
```

Those files are in the v1 manifest, so `v1:check` will warn about them. That is
an expected warning after a schema change — re-snapshot with the migration.

---

## 10. Shipping a v2 change — the checklist

1. `npm run v1:check` — start from a clean, passing state.
2. Name the area. Confirm nothing else in flight touches the files you are about
   to touch (§2). If something does, resolve that first; do not work around it.
3. Build v2 in **new files** beside the old ones. The only edit to a v1 file is
   the one-line branch at the route or layout level (§3).
4. Any migration: additive only (§4). Any new column on `tenants`: grant it to
   `anon` (§4). Any new trigger on an existing table: tenant-guarded, wrapped,
   reviewed (§6).
5. Any edge function work: new `-v2` function, never an edit (§7).
6. Every query filters by `tenant_id` (§5). Check this again before you open the
   PR — it is the one class of bug nothing else will catch.
7. `npm run v1:check`. It must pass, or every finding must be an intentional,
   reviewed change committed together with a fresh baseline.
8. Gate the area to `northwind` only. Verify on the canary.
9. Widen: 1–2 friendly tenants → everyone. Stop at any step that surprises
   you.
10. Once it is live for every tenant: delete the v1 files for that area, delete
    the branch in the route, delete the entry from `V2_AREAS`. Then re-snapshot.

---

## 11. Files worth reading, in this order

```
apps/booking/src/app/page.tsx
    The strangler pattern, done correctly, already in production. Read this
    first — it is the shape every v2 gate copies.

apps/booking/src/app/booking-v2/page.tsx
    The standing-preview route pattern.

supabase/migrations/20260820150000_add_booking_v2_flag.sql
    The `tenants` anon-grant trap, documented at the scene.

scripts/v1-check/shared.mjs
    Every query behind the numbers in this document.

scripts/v1-check/check.mjs
    What the guardrail actually asserts, smoke queries included.

CLAUDE.md
    The v1 architecture. Long, and parts of it have drifted — verify anything
    load-bearing against the database rather than trusting the prose. It is
    wrong about portal's middleware, among other things (§9).
```
