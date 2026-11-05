# V2_PLAN.md

How Drive247 is being rebuilt. If you are an AI agent picking up this work with
no other context, read this file first and in order.

Refreshed 2026-11-03 against production and `main` at `2ebd6c33`. Numbers go stale
fast: re-measure before relying on one (`scripts/v1-check/shared.mjs` holds the
queries). Where this file and the code disagree, the code wins, so fix this file.

**Where to start:**

| You want | Read |
|---|---|
| What Northwind is today, surface by surface | §13 |
| What happens next, in order | §14 |
| What is waiting on Ghulam | §15 |
| The rules (these do not change) | §0 to §12 |

Section numbers are stable on purpose: code comments across the repo cite them.

---

## 0. Read this before you write a single line

Two things will cause real damage faster than anything else you can do here.

**One — there is no staging deploy.** You are working on `main`, in the repo that
deploys, against the production database that ~34 subscribed operators are running
their businesses on right now. A staging Supabase branch exists
(`ksmreaadhbirzakkxqrq`) for local work, but no deployed site sits between you and
them. A migration you apply to production is applied to their data. An edge
function you redeploy is serving their customers within seconds.

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
- Every other tenant (69 rows, 34 subscribed on 2026-11-03) continues to see v1,
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
is gated so that **`northwind` sees it and nobody else does**. The other
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

**Key the gate on the tenant SLUG, never on a tenant id.** The same tenant has
a different primary key in every environment — `northwind` is
`6e5c544f-…` in production but `8e6bc88f-…` on the staging branch, because
staging was seeded rather than cloned. An id-keyed gate therefore resolves to
**v1 on localhost while you are building v2**, with no error, no failed build
and no failed check. The developer concludes the feature is not wired up yet.
That is the worst failure this model can produce, and it has already happened
once. The slug is stable across every environment; use it.

```ts
// apps/portal/src/lib/v2.ts   (shortened; the file carries the reasoning)
export const NORTHWIND = 'northwind';

const V2_AREAS: Record<V2Area, readonly string[]> = {
  dashboard: [NORTHWIND],
  rentals:   [NORTHWIND],
  turo:      [NORTHWIND, 'car-rental-deal-hq'],
  // appearance theme chrome login customers cms vehicles insights
  // availability agreements finances: all [NORTHWIND]
};

export function isV2(
  area: V2Area,
  tenantSlug: string | null | undefined,
  onV2: boolean = false,                // tenants.portal_experience === 'v2'
): boolean {
  if (!tenantSlug) return false;        // unknown tenant ⇒ v1, always
  if (onV2) return true;
  return V2_AREAS[area]?.includes(tenantSlug) ?? false;
}
```

**There are two ways in, OR'd.** The slug list above, and since 2026-09-17 the row
column `tenants.portal_experience = 'v2'`, because a self-serve signup cannot be in
a list compiled at build time. A `v2` row gets **every** area at once, and the lean
product with it. The row is read once per request (`lib/portal-tenant.ts`), the
gates are resolved once (`lib/v2-server.ts`, `serverIsV2`), and client components
read the answers from context (`useV2`, `useIsLean`, `useIsAreaHidden`). Modules
holding the rule stay pure: a cached answer would be one tenant's gate served to
the next tenant.

Note `V2_AREAS` is annotated rather than `satisfies`-ed. With `as const` the
value type narrows to a literal union, and `.includes()` on a `readonly
['northwind']` rejects any other string — so the call silently stops being a
membership test and starts being a type error that `ignoreBuildErrors: true`
throws away. That has also already happened once.

Widening an area is an edit to that one file and a deploy — reviewed like any
other change, reverted like any other change, and recorded in `git log`, which
is more history than a toggle in a dashboard ever gave. It needs no migration,
so the gate can never break v1's schema; it costs no query, so the gate can
never fail.

Three properties of it are not optional:

**It fails to v1.** If resolving the tenant throws, or comes back empty, the
answer is v1 and every tenant sees the screen they already had. A gate that
fails *open* puts every tenant on unfinished code at once.

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
import { serverIsV2 } from '@/lib/v2-server';
import LegacyVehicles from '@/components/vehicles/legacy-vehicles';
import VehiclesV2 from '@/components/vehicles-v2/vehicles-v2';

export default async function VehiclesPage() {
  // Never throws; an unresolved tenant answers v1.
  return (await serverIsV2('vehicles')) ? <VehiclesV2 /> : <LegacyVehicles />;
}
```

```
apps/portal/src/components/vehicles/        ← v1. Untouched. Deleted at the end.
apps/portal/src/components/vehicles-v2/     ← v2. Yours.
```

Working examples to read before you write your own:

- `apps/portal/src/app/(dashboard)/finances/page.tsx`: a v2-only route, server
  gated with `serverIsV2`. The cleanest current shape.
- `apps/booking/src/lib/booking-design.ts`: the booking side's gate, plain logic
  with no Next.js imports so it can be tested directly.

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

### Where this rule has already slipped

Measured 2026-11-03: **101 non-`-v2` portal files call `useV2(`**, about 110 of the
calls on the catch-all `chrome` area, and the biggest v1 pages carry inline gates
(`settings/page.tsx`, `rentals/[id]`, `customers/[id]`). Those gates are no longer
"three deletions" to retire. Do not add to the count: new work goes in `-v2` files,
and a shared file gets forked, never given a v2 branch (grep its importers first).
Paying this down is in §14, Phase 3.

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

`public.tenants` had **269 columns, 73 of them boolean** when this was written, and
has 281 columns today. Many are
orphaned — flags for features that shipped, were removed, or were never
finished, still being selected on every tenant load.

**New feature flags do not go on `tenants`.** The next boolean here is #74. It
would be selected on every tenant load forever, it would need its own `anon`
grant or it takes every booking site down on the day it lands, and it would
outlive the feature it was added for exactly the way the orphans above did.

v2 gates live in application code instead (§2), keyed on the tenant slug. They
cost no column, no grant, no migration and no query — and deleting one is
deleting a line. `portal_experience` is the one deliberate exception, shipped with
its grant and a reader that retries without the column on a permission error.

---

## 5. ⚠️ TENANT ISOLATION — there is no database-level net

**Read this twice.**

RLS is **disabled** on the tables the entire business runs on:

```
rentals          RLS OFF
customers        RLS OFF
payments         RLS OFF
invoices         RLS OFF
ledger_entries   RLS OFF
fines            RLS OFF

tenants, vehicles, app_users   RLS ON (since this file was first written)
```

**69 of 338 public tables have RLS disabled overall** (2026-11-03).

Most of those tables have policies written on
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

There are **233 triggers** on public tables today. Two real ones show both
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
  -- Resolve the canary by SLUG, not by a literal id: the same tenant has a
  -- different primary key in every environment, so a hardcoded uuid makes the
  -- trigger a no-op everywhere except the one database it was written against.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = NEW.tenant_id AND slug = ANY (ARRAY['northwind'])
  ) THEN
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

There are **389 edge functions** in `supabase/functions/` and **416 deployed**
(35 deployed have no source in the repo; 8 in the repo are not deployed, some on
purpose, such as `reset-password-with-otp`). **83** have `verify_jwt = false` in
`supabase/config.toml`, publicly callable without a JWT (third-party webhooks that
verify their own signatures, cron targets, and a few genuinely public endpoints).

Deploy one function per command and verify each one behaviourally. See "Deploying
edge functions" in `CLAUDE.md`: a batch deploy has reported success while serving
old code.

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
const fn = isV2('checkout', tenant.slug)
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

### Current state: failing, and not yet reviewed

Run on 2026-11-03, **`v1:check` fails**. The baseline was last snapshotted on
2026-09-07, and two months of accepted work sit on top of it. The findings include
real behaviour worth a human look, not only noise: `block_insert_while_paused`
BEFORE INSERT on `rentals`, `customers` and `vehicles`, and the
`accounting_v2_capture` triggers on `invoices`, `ledger_entries`, `payments` and
`payment_applications`, plus edge function changes including `_shared`,
`apply-payment`, `auto-extend-rentals` and `boldsign-webhook`.

So today a failure tells you nothing about *your* change. Do not re-snapshot to
quiet it. Reviewing it and taking a deliberate new baseline is §14, Phase 2.

---

## 9. Reference — facts an agent needs

**Production Supabase**

```
project ref   hviqoaokxvlancmftwuo
tables        338 public   (69 without RLS)
functions     706 public
triggers      233 public
edge fns      389 in repo, 416 deployed  (83 with verify_jwt = false)
tenants       69 rows      (34 with an active/trialing/past_due subscription)
                           (measured 2026-11-03)
```

RLS helper functions, still used by the tables that do have RLS on:
`get_user_tenant_id()`, `is_super_admin()`, `is_primary_super_admin()`,
`is_global_master_admin()`. Super admins have `tenant_id = NULL` in `app_users`,
which is a live source of bugs in any edge function that reads
`appUser.tenant_id` without handling null.

**The apps**

Four. `apps/bonzah` was deleted from the repo on 2026-10-04.

| App | Purpose | `.from('…')` call sites |
|---|---|---|
| `apps/portal` | operator admin portal | ~1,520 |
| `apps/booking` | customer booking + customer portal | ~410 |
| `apps/admin` | super-admin dashboard | ~300 |
| `apps/web` | marketing site and self-serve signup | 8 |
| | **total** | **~2,240** |

`shared/` holds code used across apps: `shared/portal-v2/` (the v2 table, card and
token kit, used by the operator portal and the customer portal) and
`shared/trax-support/` (the support inbox, used by portal and admin).

Those direct `.from()` calls **are the Supabase coupling.** They are what
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
8. Gate the area to `northwind` only, **keyed on slug** (§2). Then verify it
   properly — see "Verifying a gate" below. A gate that resolves to v1 with no
   error is the failure this model produces most often, and the one that looks
   least like a failure.
9. Widen: 1–2 friendly tenants → everyone. Stop at any step that surprises
   you.
10. Once it is live for every tenant: delete the v1 files for that area, delete
    the branch in the route, delete the entry from `V2_AREAS`. Then re-snapshot.

### Verifying a gate — three cases, and never on status codes

`notFound()` under portal's `(dashboard)` tree returns **HTTP 200**, not 404.
The dashboard layout streams the response before the nested page resolves, so
the status is already committed. The 404 *screen* renders correctly; the status
line lies. Any smoke check that proves a gate is closed by asserting on a
status code will pass while proving nothing.

So assert on **rendered content**, and test three tenants, not two:

| Case | Expect |
|---|---|
| `northwind` | the v2 component is present in the HTML |
| a real non-canary tenant | it is absent |
| a slug that does not exist at all | it is absent |

Two cases cannot distinguish "the gate correctly refused" from "tenant lookup
returned nothing, so everything renders empty". The third is what separates
them. Note also that the SSR HTML under `(dashboard)` is only the auth
skeleton, so assert on something that survives to the client, or read the RSC
payload.

### Removing a feature — prove completeness, don't infer it

`v1:check` **cannot** tell you a removal was complete. It detects files that
changed or disappeared; a file that should have been deleted and wasn't has not
changed, so it produces no finding at all. A 17-file removal and an 18-file
removal both come back clean.

After the removal commit, run a positive assertion built from the feature name,
not from your delete list:

```bash
git ls-tree -r --name-only HEAD | grep -icE 'inshur'   # must be 0
```

Build the pattern independently of whatever produced the delete list, and make
no separator assumptions — `cmd-` misses `add_cmd_poll_cron.sql`, and `inshur-`
misses `use-inshur.ts` and `INSHUR.pdf`. A checklist inherits the blind spots of
the pass that wrote it; checking it with the same pattern only confirms them.

Removing the source does **not** undeploy an edge function, and does not
unschedule a `pg_cron` job. Both outlive the commit. Check
`cron.job` and the deployed function list separately.

---

## 11. Files worth reading, in this order

```
apps/portal/src/lib/v2.ts, v2-server.ts, lean-areas.ts
    The portal's gates, with the reasoning and the history of what went wrong.

apps/booking/src/lib/booking-design.ts
    Which design a booking request gets. The Northwind routing, in one file.

PROJECT_CONTEXT.md
    The full repo map: apps, routes, edge functions, data model, scripts.

QA/QA_GUIDE.md, QA/MASTER_PLAN.md
    How everything gets tested. Untracked in git as of 2026-11-03.

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

---

## 12. Design

Rules for how v2 looks and moves. Every v2 screen follows them; a screen that
does its own thing is a screen that reads as a different product.

### Motion — one animation, everywhere

**The reference is the Trax panel** — the one that opens from **Help** in the
top bar (`apps/portal/src/components/trax/trax-panel.tsx`, the `shown` class
list on the `<aside>`). Every animation matches it — in **every app**: portal
(v1 and v2), booking site and customer portal, super admin and the marketing
site. This is the one deliberate exception to "v1 never
moves": the owner chose one motion language for the whole product (Sep 27
2026), for every tenant. Nothing gets its own duration or its own curve.

It is applied at the **primitive** level — each app's dialog, alert-dialog,
sheet, popover, dropdown, select, tooltip and toast components — so a new
screen built from them inherits it for free. Don't restyle motion per screen.

Deliberate exceptions: the filter **flip** (`rentals-overview-flip.tsx`, a
0.62s card turn — its own animation, on purpose), continuous loaders (spin,
pulse, skeletons), charts, carousels and drag interactions.

| | In (appear / hover on) | Out (disappear / hover off) |
|---|---|---|
| Duration | **200ms** | **200ms** |
| Easing | **ease-out** — starts fast, settles | **ease-in** — leaves quickly |
| Opacity | 0 → 1 | 1 → 0 |
| Movement | rises into place from `translate-y-3` (12px) | sinks back 12px |

```
in   [transition:transform_200ms_ease-out,opacity_200ms_ease-out]
out  [transition:transform_200ms_ease-in,opacity_200ms_ease-in]
     motion-reduce:transition-none      ← always
```

The rules that follow from it:

- **Animate `transform` and `opacity` only.** Never width, height, top/left or
  colour snaps. They are the two properties the browser can animate without
  re-laying out the page.
- **Things that appear** (panels, popovers, dialogs, toasts, menus) use the
  full motion: fade plus the 12px lift.
- **Hover states** use the same 200ms and the same curves, but fade only — a
  card does not jump 12px under the cursor.
- **Gradients cannot be transitioned** — `background-image` snaps. Put the
  gradient on its own `absolute inset-0` layer and fade that layer's opacity
  (see the hover wash in `app/(dashboard)/integrations/integrations-board.tsx`).
- **Something that leaves must stay painted until it has left.** If it becomes
  `invisible` or unmounts, delay that by the 200ms, as the Trax panel does with
  `visibility_0s_linear_200ms`; otherwise the exit animation never shows.
- **`motion-reduce:transition-none` on every animated element.** An operator
  who has asked their OS for less motion gets none.

---

## 13. Northwind today

Measured 2026-11-03 on `main` at `2ebd6c33`. Northwind is the product v2 will become,
so this is the map of that product across all its surfaces.

### The tenant

```
slug / id        northwind / 6e5c544f-b374-451f-a662-360a634bff15
type             test, portal_experience = 'v2' (so every portal area is on)
data             60 rentals, 25 customers, 10 vehicles, 69 payments, 42 invoices,
                 15 agreements, 0 fines (synthetic only)
stripe_mode      test
BoldSign         column says test, but lean forces LIVE: a send spends real credits
                 and produces a binding document
setup            setup_completed_at is NULL
```

Other `portal_experience = 'v2'` rows: only `ghulam` (production type, created
2026-10-28, subscription cancelled; looks like a signup test). One real tenant
touches a v2 area: `car-rental-deal-hq`, for Turo Sync only. **No real operator is
on v2.** The 1 Oct 2026 launch date has passed without a widening, and the Notion
tracker's Tasks database has 0 rows.

### Operator portal (`apps/portal`, `{slug}.portal.drive-247.com`)

The v2 rail: Dashboard, Customers, Vehicles, Rentals, Insights, Insurances,
Agreements, Availability, Finances, Support, Integrations, Billing, Rewards, plus a
Portal / Website switch into the CMS. 25 `components/*-v2/` directories, about
120,000 lines.

| Area | Route | v2 state | Gate |
|---|---|---|---|
| Dashboard | `/` | Built, with setup checklist | `dashboard` |
| Rentals list | `/rentals` | Built | `rentals` |
| Rental detail | `/rentals/[id]` | Built: 8 stages, rail | `rentals`, beside 8.2k-line v1 |
| New rental | `/rentals/new` | Drafts added, but **6.8k-line v1 page** with inline gates | `rentals` |
| Customers | `/customers`, `[id]` | List restyled in place, detail built | `chrome`, `customers` |
| Vehicles | `/vehicles`, `[id]` | List restyled in place, detail built | `chrome`, `vehicles` |
| Finances | `/finances` | Built: tabs over Payments, Invoices, Fines | `finances`, server |
| Insights | `/insights` | Built, replaces Reports and P&L | `insights`, server |
| Agreements | `/agreements` | Built, templates and individual sends | `agreements` |
| Availability | `/blocked-dates` | Built, saves hours and blocked dates (the comment in `v2.ts` calling it read-only is out of date) | `availability` |
| Insurances | `/insurances` | Restyled in place | `chrome` |
| Integrations | `/integrations` | Built: per-integration panels | `appearance`, server |
| Settings | `/settings` | v2 pages inside a 7.5k-line v1 page | mixed |
| Notifications | `/settings?tab=notifications` | UI built, **see gap below** | mixed |
| Billing | `/subscription` | Built | `chrome` |
| Support | `/support` | Built, tickets | `chrome`, server |
| Messages | `/messages` | Built, **ungated for all tenants** | none |
| Trax | `/trax` | Built, **route has no gate** | none |
| Website (CMS) | `/cms` | Built, visual editor | `cms` |
| Onboarding | layout | First-run wizard, first-rental tour | `useIsLean` |

**Hidden from Northwind (lean), still live for everyone else:** enquiries, leads,
automations, quotes, tesla, welcome, owners, expenses, accounting, fleet-health,
cmd, inshur, tenant-health, reports, pl-dashboard, reminders, and the Settings tabs
for payments, messaging, insurance and e-sign. Parked means hidden, never deleted.

### Booking site (`apps/booking`, `{slug}.drive-247.com`)

Gate: slug in `NEW_DESIGN_TENANTS` (`lib/booking-design.ts`), with the middleware
rewriting the URL. Code in `src/northwind-site/` via `@nw/*`. Tailwind 4 compiled
ahead of time: re-run `node scripts/build-northwind-css.mjs` after new class names.

| Surface | State |
|---|---|
| Public pages: home, fleet, about, contact, blog, promotions, reviews, privacy, terms | v2, at the normal links |
| Auth: login, signup, forgot-password, invite register | v2 |
| Vehicle booking page `/booking/[vehicleId]` | v2 UI and quote work, **payment cannot complete** |
| Quick book dialog ("Book a car") | **Prototype, charges and writes nothing**, and says so on screen |
| Contact form | **Fake send**: waits 600ms and reports success |
| `checkout`, `pay`, `offer`, `verify`, `apply`, `auth`, `booking-*`, `sms-opt-in` | **Still legacy pages**, by design for now |

### Customer portal (`/portal` on the booking site)

v2 at the normal link, folder `portal-v2`. Rentals, bookings, agreements, documents,
insurances, Finances, messages, notifications, verification, gig driver, settings,
customer Trax, and the phone layout. Rentals and Agreements share the operator's
screens through `shared/portal-v2`. Paying from Finances calls the same missing
payment function below.

### Signup and onboarding (`apps/web`)

`signup-begin` → `signup-verify-otp` → `signup-payment-intent-v2` →
`signup-provision` (writes `portal_experience = 'v2'`) → first-run wizard →
first-rental tour → setup checklist. **The signup redesign is uncommitted in the
working tree**, along with the OTP helper changes and Phoenix tracing on the `trax-*`
functions (`_shared/phoenix.ts`, migration `20261027120000`). Landing switches:
`landing_version` is `v1` and `landing_pricing_enabled` is false in production.

### Super admin (`apps/admin`)

One app for all tenants, not gated by tenant. It has the Northwind rail and the phone
layout. Strict TypeScript: a type error here fails the build.

### Known gaps, verified 2026-11-03

**Blocks a real customer journey on Northwind**

1. **Renters cannot pay.** `create-booking-payment-intent` is not on `main` and not
   deployed. The source (691 lines) is on `origin/haseeb/staging/booking-side` and
   `origin/improv/staging/booking-site`. The booking page and customer Finances both
   call it and get a 404.
2. **Quick book is simulated.** Its planned real version is a manual-capture card
   hold, captured after the licence check. Its clock offers :15 and :45 while booking
   validation uses 30-minute slots.
3. **The contact form sends nothing.**
4. **Notification settings do not drive sends.** No edge function reads
   `tenant_notification_settings`, so switches and wording change previews only.
5. **Support email never goes out.** 17 `trax_support_email_jobs` sit pending because
   no cron runs `trax-support-notifications`.

**Blocks widening beyond Northwind**

6. **The booking site does not follow `portal_experience`.** `usesNewDesign` reads the
   slug list only, so a v2 signup gets the v2 operator portal and the legacy booking
   site.
7. **Going lean removes features real tenants use.** The lean list hides enquiries,
   reminders, owner payouts and more. Moving a real tenant onto `portal_experience =
   'v2'` takes those away from them.
8. **Lean is mirrored by hand** in portal, booking and edge. All three say
   `['northwind']` today and must move together.

**Trust**

9. **Four pricing calculators, three different.** Portal and booking match; `_shared`
    and `northwind-site/lib/domain` each differ. No golden tables exist yet, and no
    app has Sentry.
10. **`v1:check` is failing and unreviewed** (§8).

**Security, live for every tenant today**

11. `exec_sql(text)` is **executable by anon**: arbitrary SQL using the public key.
12. 9 reporting views (`view_payments_export`, `view_rentals_export`,
    `view_customer_statements` and others) are selectable by anon.
13. The `customer-documents` bucket (licences, selfies) is public.
14. 35 deployed functions have no source in the repo, including `run-migration`,
    `cleanup-rls` and `fix-rls-v2`.

---

## 14. The plan

**A proposal for Ghulam to edit, not an agreed schedule.** Each phase has an exit test.
Nothing here is pushed or deployed until Ghulam says so.

### Phase 0: Close the open doors

The one phase that is not canary-gated, because the exposure is on every tenant. Each
step is a production change and needs Ghulam's explicit go-ahead.

- Revoke `exec_sql` from anon, PUBLIC and authenticated, keeping service_role. Haris's
  `00a` containment was written for this. Then the wider `00b` sweep.
- Revoke anon on the 9 reporting views. First confirm no booking-side code reads them.
- Move `customer-documents` to private with signed uploads. This needs code first, so
  it is not a one-line flip.
- Review the 35 source-less deployed functions and undeploy the dead ones.

**Exit:** the `has_function_privilege` and `has_table_privilege` checks return false
for anon, and the bucket refuses an anonymous read.

### Phase 1: Northwind works, end to end, for real

- Bring `create-booking-payment-intent` onto `main` as new code. Read it against
  today's booking contract in `hooks/use-payment-intent.ts` first, since it was
  written on a diverged branch in September. Keep it in Stripe test mode.
- Decide quick book (§15). Either make it real or remove the trigger, but do not leave
  a "Prototype" screen in a live flow.
- Contact form: send for real.
- Wire `tenant_notification_settings` into real sends, for Northwind only, on new code
  paths.
- Schedule `trax-support-notifications`, and drain or clear the 17 stale jobs.
- Move `verify`, `pay`, `checkout` and `offer` to v2 screens, one at a time. These
  addresses are sent by email, SMS and Stripe, so existing links must keep working.
- Rebuild New Rental as a v2 file, replacing the inline gates in the 6.8k-line page.
- Land the uncommitted signup redesign once Ghulam has reviewed it.

**Exit: one person walks the whole journey on Northwind with nothing simulated.** Sign
up → first-run → add a car → renter books and pays by test card → agreement signed →
verification → keys → extension → return → refund, with correct money on every screen
and the right messages sent.

### Phase 2: Prove it

- Golden tables and Vitest for pricing, then reduce to one implementation per rule
  (`QA/QA_GUIDE.md` §8, §10).
- Tenant isolation in three layers: code scan, cross-tenant mismatch queries returning
  0, and a leak-test tenant.
- Work through the QA modules and flows in `QA/MASTER_PLAN.md`. Commit `QA/`.
- Sentry on all four apps.
- Review every `v1:check` finding, then take a deliberate new baseline, committed with
  the reasons.
- Phone pass on the directories with no breakpoint classes: `insurance-v2`, `fleet-v2`,
  `invoices-v2`, `credits-v2`. They may inherit from shared kit, so check on a real
  phone before changing anything.

**Exit:** `v1:check` is green and means something again, and the golden tables pass
against every calculator.

### Phase 3: Make it widenable

- **Booking follows the tenant:** drive the design from the row as well as the slug,
  so a v2 signup also gets the v2 site. Keep the anon-grant trap (§4) in mind.
- **Separate "v2 UI" from "lean".** Today a v2 row gets both, so a real tenant cannot
  get the new UI and keep its enquiries, reminders or payouts. Needs a decision (§15).
- **Bring those kept features into v2 UI** where real tenants rely on them.
- Fold `lean-areas.ts` into `v2.ts`, which its own TODO asks for. Replace the hand
  mirrors with one source, or a test that pins them equal.
- Remove the dead switch: `V2_BUILT_SEGMENTS` is empty, so
  `northwind_site_version` and its Developer-tab card no longer change anything.
- Retire `(northwind)/northwind-site`, the older design tree, once nothing routes to
  it.
- Give `/trax` a proper gate. Decide whether ungated `messages-v2` and `timeline-v2`
  stay that way on purpose, and write the answer here.
- Split the catch-all `chrome` area where it blocks area-by-area widening.

**Exit:** a new test tenant, created only through signup, gets the full v2 product on
both sides without a deploy, and a v1 tenant sees no change.

### Phase 4: Widen

```
northwind → new self-serve signups → 1-2 friendly tenants → everyone
```

New signups come first because they have no habits or data to break. Before a real
tenant moves: check which lean-hidden features it uses, take a snapshot of its key
money totals, and agree a way back (`portal_experience = 'v1'`). Pause at least one
full billing and rental cycle between steps. When messaging tenants about this, say
what is now available, never what was broken.

**Exit:** every subscribed tenant is on v2.

### Phase 5: Retire v1, then move off Supabase

- Area by area: delete the v1 files, the route branch and the `V2_AREAS` entry, then
  re-snapshot. Prove each removal with the independent grep in §10, and check crons
  and deployed functions separately.
- Only then the owned API layer and the AWS move. `apps/api` is not on `main` today.

---

## 15. Waiting on Ghulam

| # | Decision | Recommendation |
|---|---|---|
| 1 | Go-ahead for Phase 0 on production | Yes, and first. It outranks everything else here |
| 2 | Quick book: real, or removed? | Make it the real flow using a card hold, and retire the long booking page later |
| 3 | v2 UI separate from lean? | Yes. It is the only way paying tenants can move without losing features |
| 4 | Which lean-hidden features return in v2 for real tenants | Decide from per-tenant usage. Enquiries (on for 51 tenants when measured in September) and reminders look like the first two |
| 5 | PAYG and installments | Park both for new tenants, per the 2026-11-03 usage research (4 and 1 rentals ever). Fix auto-extend gaps first |
| 6 | Credits versus monthly add-ons | Proposed 2026-09-18, still unapproved. v2 Billing already has no Credits tab |
| 7 | Subscription first charge: per-plan trial, or $1 then first charge at one month | Confirm which is current. Signup now uses per-plan `trialDays`, and the $1 model note dates from June |
| 8 | First friendly tenants | Ghulam's call. Prefer one with few lean-hidden features in use |
| 9 | A new launch date | The Notion tracker is empty, so say if it should be rebuilt from §14 |
