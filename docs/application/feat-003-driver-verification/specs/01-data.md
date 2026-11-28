# Spec 01 · The data

**Feature:** feat-003 · Driver verification, part 1 · **PRD stories:** all · **Status:** Draft

## What this covers

Every table, column, type and policy the module needs, in one migration file. The rules that fill
these tables are in the later specs; this spec says what may be stored, who may read it and who may
write it. The old verification tables (`identity_verifications`) are not changed.

## Behaviour

- **01.1** One migration file, `supabase/migrations/20261129100000_driver_verification_v2.sql`, creates everything below. It is applied whole to staging; nothing is altered in place afterwards.
- **01.2** The enum `verification_status_v2` holds exactly: `not_verified`, `link_sent`, `in_progress`, `verified`, `needs_review`, `failed`, `expired`.
- **01.3** `verification_services` (the price list) has one row per service: `standard`, `licence_status`, `driving_record`, `criminal_record`, `licence_watch`, `rideshare_proof`.
- **01.4** `standard` is `kind = 'free'`, `availability = 'live'`, `provider = 'didit'`. `licence_status` is premium, `live`, `rentid`. `driving_record` and `criminal_record` are premium, `switched_off`, `rentid`. `licence_watch` and `rideshare_proof` are `coming_soon` with no provider.
- **01.5** Every price column is a whole number of cents, `not null`, and `>= 0`.
- **01.6** A signed-in staff member of any company can read `verification_services` and `verification_state_fees`. Only a super admin or the service role can insert, update or delete them.
- **01.7** `verification_sessions` rows of company A cannot be read by a staff member of company B, through the REST API with B's token.
- **01.8** Staff can read their own company's sessions, session checks, events and charges. Staff cannot insert, update or delete any of them directly: every write goes through the edge functions (service role).
- **01.9** The anonymous key can read nothing from any table in this spec.
- **01.10** `verification_session_checks` has at most one row per (session, service): a second insert of the same pair is refused.
- **01.11** `verification_charges` has at most one row per (session, service): a second insert is refused.
- **01.12** `verification_sessions.token` is unique, and is at least 43 characters of URL-safe random text (32 random bytes).
- **01.13** At most one session per customer is open (`link_sent` or `in_progress`): a partial unique index refuses a second open one.
- **01.14** `customers` gains `verification_status verification_status_v2 not null default 'not_verified'`, `verification_session_id`, `verification_warning`, `licence_expiry_date`, `licence_document_type`, `licence_document_subtype`, `licence_issuing_country`, and `identity_details_source` (`typed` or `verified`, null when no details).
- **01.15** Existing customers keep working: after the migration every existing customer row has `verification_status = 'not_verified'` and nothing else on the row changes.
- **01.16** Deleting a customer deletes their sessions, session checks and events (cascade). Charges are kept: their `customer_id` becomes null and `customer_name` keeps the name, so a past bill can still be explained.
- **01.17** `verification_tenant_prefs` holds one row per company with `last_ticks text[]`. It is read by the company's staff and written only by the service role.
- **01.18** No column in this spec stores a Didit or RentID key or secret.

## Worked examples

None. (Prices are worked in spec 09.)

## Database

Migration `supabase/migrations/20261129100000_driver_verification_v2.sql`.

```text
type verification_status_v2   enum (01.2)
type verification_kind_v2     enum ('free','premium')
type verification_avail_v2    enum ('live','switched_off','coming_soon')
type verification_result_v2   enum ('pending','pass','fail','could_not_check','not_run','not_set')
type verification_sent_via_v2 enum ('email','sms','qr','copy')
type verification_event_v2    enum ('session_created','link_emailed','link_texted','link_copied','code_shown',
                                    'reminder_sent','link_opened','consent_given','consent_refused',
                                    'check_started','standard_result','premium_started','premium_result',
                                    'cancelled','expired','replaced')

verification_services
  key text primary key                     -- 01.3
  name text not null, description text not null
  kind verification_kind_v2 not null
  availability verification_avail_v2 not null
  provider text check (provider in ('didit','rentid'))
  provider_cost_cents integer not null default 0 check (>= 0)
  margin_cents integer not null default 0 check (>= 0)
  has_state_fee boolean not null default false
  needs_consent boolean not null default false
  sort_order integer not null
  updated_at timestamptz not null default now()

verification_state_fees
  service_key text references verification_services(key)
  state char(2) not null check (state ~ '^[A-Z]{2}$')
  fee_cents integer not null check (>= 0)
  primary key (service_key, state)

verification_sessions
  id uuid pk default gen_random_uuid()
  tenant_id uuid not null references tenants(id) on delete cascade
  customer_id uuid not null references customers(id) on delete cascade
  started_by uuid references app_users(id) on delete set null
  status verification_status_v2 not null default 'link_sent'
  token text not null unique
  expires_at timestamptz not null              -- created_at + 24 hours
  sent_via verification_sent_via_v2 not null
  sent_to text                                 -- address or number, null for qr/copy
  didit_session_id text unique
  replaced_by uuid references verification_sessions(id)
  opened_at, consent_at, finished_at, cancelled_at timestamptz
  cancelled_by uuid references app_users(id) on delete set null
  consent_text_version text
  reminders_sent integer not null default 0
  created_at timestamptz not null default now()
  unique index one_open_per_customer on (customer_id) where status in ('link_sent','in_progress')   -- 01.13

verification_session_checks
  id uuid pk
  session_id uuid not null references verification_sessions(id) on delete cascade
  tenant_id uuid not null references tenants(id) on delete cascade
  service_key text not null references verification_services(key)
  provider_cost_cents integer not null       -- frozen at session creation (spec 09)
  margin_cents integer not null
  state_fee_cents integer                    -- null until the state is known
  consent text check (consent in ('given','refused'))
  result verification_result_v2 not null default 'pending'
  lines jsonb not null default '[]'          -- the result lines (spec 07, 08)
  reason text
  raw jsonb                                  -- the provider's answer, kept to explain a result
  provider_ref text                          -- Didit session id / RentID request_id
  started_at, finished_at timestamptz
  unique (session_id, service_key)                                       -- 01.10

verification_session_events
  id bigserial pk
  session_id uuid not null references verification_sessions(id) on delete cascade
  tenant_id uuid not null references tenants(id) on delete cascade
  kind verification_event_v2 not null
  detail jsonb not null default '{}'
  at timestamptz not null default now()

verification_charges
  id uuid pk
  tenant_id uuid not null references tenants(id)
  session_id uuid references verification_sessions(id) on delete set null
  customer_id uuid references customers(id) on delete set null
  customer_name text not null
  service_key text not null references verification_services(key)
  provider_cost_cents, state_fee_cents, margin_cents integer not null check (>= 0)
  total_cents integer generated always as (provider_cost_cents + state_fee_cents + margin_cents) stored
  currency text not null default 'usd'
  stripe_account text check (stripe_account in ('uk','uae'))
  stripe_mode text check (stripe_mode in ('test','live'))
  stripe_invoice_item_id text unique
  sent_at timestamptz, attempts integer not null default 0, last_error text
  created_at timestamptz not null default now()
  unique (session_id, service_key)                                       -- 01.11

verification_tenant_prefs
  tenant_id uuid pk references tenants(id) on delete cascade
  last_ticks text[] not null default '{standard}'
  updated_at timestamptz not null default now()

customers (added columns)                                                -- 01.14
  verification_status verification_status_v2 not null default 'not_verified'
  verification_session_id uuid references verification_sessions(id) on delete set null
  verification_warning text
  licence_expiry_date date, licence_document_type text, licence_document_subtype text,
  licence_issuing_country text
  identity_details_source text check (identity_details_source in ('typed','verified'))
```

RLS is enabled on every new table. Policies:

| Table | select | insert / update / delete |
|---|---|---|
| `verification_services`, `verification_state_fees` | `authenticated` | super admin only (`is_super_admin()`) |
| sessions, session checks, events, charges, prefs | `tenant_id = get_user_tenant_id() or is_super_admin()` | none (service role only) |

`anon` has no grant on any of them. Indexes: `verification_sessions (tenant_id, created_at desc)`,
`(customer_id, created_at desc)`, `verification_session_events (session_id, at)`,
`verification_charges (tenant_id, created_at desc)`, `verification_charges (sent_at) where sent_at is null`.

The seed rows for `verification_services` are in the same file (prices from spec 09).

The old `customers.identity_verification_status` column and its check constraint are untouched.

## Functions

None in this spec.

## Screens

None.

## Money and safety

The price list decides what companies are charged, so only Drive247's team can change it (01.6).
Sessions hold the token that opens a renter's check, so no browser can read another company's rows
(01.7, 01.9). Raw provider answers may hold personal data and stay behind the same policies.

## Proof

| Statement | Proved by |
|---|---|
| 01.1 to 01.18 | `evals/01-data.mjs` |

## Not in this spec

- How a session moves between statuses (spec 05) and how results are written (specs 07, 08).
- The storage bucket for photos (spec 12).
