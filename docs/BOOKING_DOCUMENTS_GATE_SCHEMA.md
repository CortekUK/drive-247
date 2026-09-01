# Booking Documents Gate — Schema Record

> ## ⛔ NOT YET APPLIED TO PRODUCTION
>
> Everything below exists **only** on the staging Supabase branch
> `ksmreaadhbirzakkxqrq`. It has **not** been applied to production
> (`hviqoaokxvlancmftwuo`, 55 tenants).
>
> This project does not keep migration files for MCP/API-applied DDL, so **this
> document is the only record of these changes**. Prior features (Fleet Health,
> the ID waiver's CHECK constraints) are already live in production with no
> migration file, which is a recurring source of confusion. When this feature is
> promoted, re-apply the DDL in the "Exact DDL applied" section verbatim against
> production and change this banner.

| | |
|---|---|
| **Applied to** | `ksmreaadhbirzakkxqrq` (staging — a Supabase *preview branch* of production, 1 tenant: `northwind` / `8e6bc88f-86d6-4468-8610-73f7c8a88f6e`) |
| **NOT applied to** | `hviqoaokxvlancmftwuo` (production, 55 tenants) |
| **Date applied** | 2026-09-01 |
| **Branch** | `haseeb/staging/booking-side` |
| **Applied via** | Supabase Management API `POST /v1/projects/ksmreaadhbirzakkxqrq/database/query` |
| **Feature** | Post-payment customer document upload gate (booking v2) |

### Why the Management API and not the Supabase MCP tools

The standing project rule is to apply schema changes with `mcp__supabase__*`.
That rule was **not** followed here, deliberately: the MCP server in this
workspace is pinned to **production**. Verified at the time of this change —
`mcp__supabase__get_project_url` returned `https://hviqoaokxvlancmftwuo.supabase.co`,
and both `supabase/config.toml:1` and `supabase/.temp/project-ref` say
`hviqoaokxvlancmftwuo`. The MCP server exposes no project selector, so
`apply_migration` through it would have written to production. The Management API
endpoint above is the only path that reaches staging.

Guard used before the first write (returned `1`, not `55`):

```sql
select count(*) from public.tenants;  -- [{"tenant_count":1}]
```

`supabase functions deploy` has the same hazard — it **must** carry
`--project-ref ksmreaadhbirzakkxqrq` or it ships to production.

---

## Exact DDL applied

### 1. Three columns on `public.rentals`

```sql
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS documents_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS documents_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_verification_session_id uuid;

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres; guarded so this migration
-- stays re-runnable like the IF NOT EXISTS statements around it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rentals'::regclass
      AND conname  = 'rentals_documents_status_check'
  ) THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_documents_status_check
      CHECK (documents_status IN ('not_required','pending','submitted','verified','rejected'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_rentals_identity_verification_session_id
  ON public.rentals (identity_verification_session_id)
  WHERE identity_verification_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rentals_documents_status_pending
  ON public.rentals (tenant_id, documents_status)
  WHERE documents_status IN ('pending','submitted','rejected');
```

**Why the default is `'not_required'` and not `'pending'`** — every
operator-created rental across all tenants would otherwise instantly read as
awaiting documents. Only the booking-site payment path flips it to `'pending'`,
from settlement.

**Why `idx_rentals_documents_status_pending` exists** — a paid booking whose
documents never arrive stays **open**: no auto-cancel, no auto-refund
(auto-cancelling a paid booking is a money decision). The compensating control is
that it must be *findable*, so `(tenant_id, documents_status)` lets an operator or
a future sweeper list every stuck booking in one index scan.

**Do not confuse `documents_status` with the pre-existing `document_status`**
(singular). `rentals.document_status` already existed and is the **BoldSign
e-signature** state, default `'pending'`. It was not touched and must not be
repurposed. The two columns differ by one character; grep carefully.

#### `identity_verification_session_id` is a `uuid` that holds `session_id`, not `id`

`identity_verifications.session_id` is the handle every downstream consumer keys
off. `create-ai-verification-session` returns it as `sessionId`
(`index.ts:134` customer path, `index.ts:222` booking path — both
`crypto.randomUUID()`), and `process-ai-verification` looks the row up with
`.eq('session_id', sessionId)` (`index.ts:115-119`). The row's own `id` is **not**
the handle. Do not rename this column to `identity_verification_id`.

> ⚠️ **Type mismatch — cast on every join.** `identity_verifications.session_id`
> is **`text`** (verified on staging), while `rentals.identity_verification_session_id`
> is **`uuid`**. The values are UUID-shaped in practice because both writers use
> `crypto.randomUUID()`, so storage is safe — but Postgres will **not** implicitly
> compare `uuid` to `text`. Any join must cast:
>
> ```sql
> ON iv.session_id = r.identity_verification_session_id::text
> ```
>
> There is deliberately **no foreign key** for the same reason. In PostgREST /
> supabase-js, pass the value as a string; it will be coerced into the `uuid`
> column on write.

### 2. `public.booking_document_links`

```sql
CREATE TABLE IF NOT EXISTS public.booking_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_document_links_token_key UNIQUE (token),
  CONSTRAINT booking_document_links_rental_id_key UNIQUE (rental_id)
);

ALTER TABLE public.booking_document_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_document_links FROM anon, authenticated;
-- deliberately ZERO policies: service_role bypasses RLS, everyone else gets nothing.
```

**Why a separate table with RLS on, rather than a column on `rentals`** — on
staging, RLS is effectively off across these tables and `anon` holds broad
grants. Verified live in this change (see the grant matrix below):
`anon` has `SELECT` **and `UPDATE`** on both `rentals` and
`identity_verifications`. A bearer token stored on `rentals` would therefore be
readable by anyone holding the public anon key. Modelled on
`public.installment_payment_links`
(`supabase/migrations/20260427120100_installment_payment_links.sql:6-21`).

**The `UNIQUE (rental_id)` is load-bearing.** It is what makes the link mint an
idempotent upsert, so the browser and the webhook cannot race into two different
tokens for one booking. Callers **must** use the upsert form and read the token
back from `RETURNING` rather than assuming their own token was the one stored —
under a race, the **first** token wins:

```sql
INSERT INTO public.booking_document_links (tenant_id, rental_id, token, expires_at)
VALUES ($1, $2, $3, now() + interval '7 days')
ON CONFLICT (rental_id) DO UPDATE SET updated_at = now()
RETURNING token;
```

**Link lifetime is 7 days.** (The original design document said 30; 7 is the
user's decision and overrides it.) An expired link must render a working
"Email me a new link" button that actually sends a fresh link — not a dead-end
error. Expiry is enforced by reading `expires_at`; nothing in the schema deletes
expired rows, so re-minting is an upsert onto the same `rental_id`.

### 3. `public.booking_email_dispatch`

```sql
CREATE TABLE IF NOT EXISTS public.booking_email_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  provider_message_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_email_dispatch_idem_key UNIQUE (idempotency_key),
  CONSTRAINT booking_email_dispatch_status_check
    CHECK (status IN ('pending','sending','sent','failed','suppressed'))
);

ALTER TABLE public.booking_email_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_email_dispatch FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_bed_drainable
  ON public.booking_email_dispatch (status, claimed_at)
  WHERE status IN ('pending','failed','sending');

CREATE INDEX IF NOT EXISTS idx_bed_rental ON public.booking_email_dispatch (rental_id);
```

**The `UNIQUE (idempotency_key)` is the entire duplicate-email defence.** Do not
drop it and do not downgrade it to a plain index. This deliberately does *not*
repeat the precedent's own defect: `strategy_call_emails.idempotency_key` is
`NOT NULL` but has **no** unique index, so its at-most-once guarantee rests
solely on a compare-and-swap. Ours has both the CAS and the constraint.

Safe enqueue form:

```sql
INSERT INTO public.booking_email_dispatch (tenant_id, rental_id, email_key, idempotency_key, payload)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (idempotency_key) DO NOTHING;
```

---

## Verification — real output, captured after the DDL ran

All queries below were run against `ksmreaadhbirzakkxqrq` via the Management API.

**1. Columns exist with the right types and defaults**

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name='rentals'
  AND column_name IN ('documents_status','documents_completed_at','identity_verification_session_id');
```
```json
[{"column_name":"documents_completed_at","data_type":"timestamp with time zone","column_default":null,"is_nullable":"YES"},
 {"column_name":"identity_verification_session_id","data_type":"uuid","column_default":null,"is_nullable":"YES"},
 {"column_name":"documents_status","data_type":"text","column_default":"'not_required'::text","is_nullable":"NO"}]
```

**2. CHECK constraint is in place**

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.rentals'::regclass AND conname='rentals_documents_status_check';
```
```json
[{"conname":"rentals_documents_status_check",
  "pg_get_constraintdef":"CHECK ((documents_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'submitted'::text, 'verified'::text, 'rejected'::text])))"}]
```

**3. RLS is enabled on both new tables**

```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('booking_document_links','booking_email_dispatch');
```
```json
[{"relname":"booking_document_links","relrowsecurity":true},
 {"relname":"booking_email_dispatch","relrowsecurity":true}]
```

**4. No existing rental was disturbed by the backfill**

```sql
SELECT count(*) FROM public.rentals WHERE documents_status <> 'not_required';
```
```json
[{"non_default":0}]
```
(10 rentals exist on staging; all sit at the `'not_required'` default.)

**5. Zero policies — confirming "service_role only" is real, not implied**

```json
[{"relname":"booking_document_links","policies":0},
 {"relname":"booking_email_dispatch","policies":0}]
```

**6. Grant matrix — the security claim, tested rather than assumed**

```sql
select t.tbl,
       has_table_privilege('anon',          t.tbl, 'SELECT') as anon_select,
       has_table_privilege('anon',          t.tbl, 'UPDATE') as anon_update,
       has_table_privilege('authenticated', t.tbl, 'SELECT') as auth_select,
       has_table_privilege('service_role',  t.tbl, 'SELECT') as svc_select
from (values ('public.booking_document_links'),('public.booking_email_dispatch'),
             ('public.rentals'),('public.identity_verifications')) as t(tbl);
```
```json
[{"tbl":"public.booking_document_links",  "anon_select":false,"anon_update":false,"auth_select":false,"svc_select":true},
 {"tbl":"public.booking_email_dispatch",  "anon_select":false,"anon_update":false,"auth_select":false,"svc_select":true},
 {"tbl":"public.rentals",                 "anon_select":true, "anon_update":true, "auth_select":true, "svc_select":true},
 {"tbl":"public.identity_verifications",  "anon_select":true, "anon_update":true, "auth_select":true, "svc_select":true}]
```

The last two rows are the control, and they are the whole argument for these
tables existing: `anon` can read **and write** `rentals` and
`identity_verifications` on staging. The two new tables are the only ones here
that `anon` cannot touch. **Never let the browser write verification or
completion state** — it can be made to lie. All verdict writes are server-side,
via `service_role`, which bypasses RLS.

**7. Behavioural tests** — run inside `DO` blocks that raise a sentinel at the
end so all writes roll back. Confirmed afterwards that
`booking_document_links`, `booking_email_dispatch` are empty and
`rentals` still has 0 non-default rows.

| Test | Result |
|---|---|
| CHECK rejects `documents_status='confirmed'`; all 5 legal values accepted | `TEST A PASSED` |
| Two racing upserts on one `rental_id` → 1 row, both callers get the same token | `TEST B PASSED - rows=1, both callers got the same token tok_browser` |
| Duplicate `idempotency_key` insert raises `unique_violation`; `ON CONFLICT DO NOTHING` inserts 0 extra; defaults are `pending`/`0`/`{}`/`NULL` | `TEST C PASSED - rows=1, dup blocked` |

---

## Generated TypeScript types

Regenerated from **staging** and written to **one file only**:

```
v2/apps/web/src/integrations/supabase/types.ts
```

Fetched via `GET /v1/projects/ksmreaadhbirzakkxqrq/types/typescript?included_schemas=public`
(HTTP 200), because `mcp__supabase__generate_typescript_types` would have
generated production's schema.

Deliberately **not** copied into `apps/portal`, `apps/booking` or `apps/admin` —
those apps point at production and their types must not gain staging-only
columns.

Diff against the previous file: 154 changed lines, of which only **4 are
removals**:

- `integration_veriff` (×3 — `Row`/`Insert`/`Update` on `tenants`). This column
  exists in production but **not** on staging, and is referenced nowhere in
  `v2/apps/web/src` outside `types.ts`, so dropping it is both accurate and safe.
- `PostgrestVersion` `"14.17"` → `"14.5"` — staging reports an older PostgREST.
  Type-level annotation only.

Additions are the new tables/columns above, plus staging-only columns that were
already live there and simply absent from the stale file (`payment_provider`,
`payment_provider_locked_at`, `payments_ready`, `square_idempotency_key`,
`square_payment_link_id`, `square_ready`).

Note that `documents_status` generates as plain `string`, not a union — it is a
`text` column with a CHECK, not a Postgres enum. Consumers should narrow it
themselves:

```ts
type DocumentsStatus = 'not_required' | 'pending' | 'submitted' | 'verified' | 'rejected';
```

Verification:

```
$ cd v2/apps/web && npx tsc --noEmit
(no output — exit 0)

$ ./scripts-v2-guard/check-design-drift.sh
check-design-drift — scanned 189 file(s) under v2/apps/web/src (components/ui excluded)
OK — no new design drift. (4 pre-existing violation(s) allowlisted.)
exit 0
```

---

## Status semantics this schema assumes

`rentals` has exactly three pre-existing CHECK-constrained status columns, and
this change adds **no** new values to any of them:

| Column | Allowed values | Default |
|---|---|---|
| `status` | `Pending`, `Active`, `Closed`, `Rejected`, `Cancelled` | `Active` |
| `approval_status` | `pending`, `approved`, `rejected` | `pending` |
| `payment_status` | `pending`, `fulfilled`, `failed`, `refunded` | `pending` |

`'Active'` means keys were physically handed over — **not** "confirmed". The
lifecycle is `Pending/pending/pending` → (pay) `Pending/pending/fulfilled` →
(approve) `Pending/approved/fulfilled` → (key handover) `Active/...` → `Closed`.

The new `documents_status` is an independent fourth axis. It does **not** gate
approval: an operator may approve a booking whose documents are unverified, via
the existing dismissible-warning + "Approve Anyway" pattern used by every other
guard in the portal. This feature does not add the product's first hard block.

> **Copy rule that this schema exists to support.** `documents_status='submitted'`
> means *under review*, **not** confirmed. The post-upload email and the
> post-upload screen must never say "confirmed", "complete", or anything
> equivalent — they say documents received / under review / we will confirm
> shortly. The confirmation email fires at **operator approval**, via the
> existing `notify-booking-approved`
> (`apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx:7816`). Telling a
> customer their booking is confirmed while an operator may still reject it is
> the specific failure this wording rule prevents.

## Promoting to production — checklist

1. Re-run all three DDL blocks verbatim against `hviqoaokxvlancmftwuo`.
2. Re-run verification queries 1–6; query 4 **must** return 0 across all 55
   tenants before anything writes to `documents_status`.
3. Confirm `integration_veriff` still exists in production and that regenerating
   production types does not drop columns other apps rely on.
4. Redeploy edge functions **with** `--project-ref hviqoaokxvlancmftwuo`.
5. Replace the banner at the top of this file.
