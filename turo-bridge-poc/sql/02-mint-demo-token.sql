-- ============================================================================
-- Drive247 Turo Bridge (PoC) — mint one pairing token
--
-- ─── HOW TO RUN ─────────────────────────────────────────────────────────────
--  1. Apply turo-bridge-poc/sql/01-schema.sql FIRST. This script writes
--     token_hash / token_prefix, which that file adds. Running it against the
--     older plaintext shape fails with "column token_hash does not exist".
--
--  2. Open the Supabase Dashboard → SQL Editor for project hviqoaokxvlancmftwuo
--     (the editor runs as service_role, which is what this needs), or use
--     mcp__supabase__execute_sql.
--
--  3. Edit the tenant slug on the marked line below. It ships as 'test'.
--
--  4. Run it. ONE row comes back. Copy `paste_this_into_the_extension`
--     immediately and paste it into the extension popup's "Pairing token" box.
--
--  5. Close the tab. THE PLAINTEXT IS NOT RECOVERABLE. It exists only in this
--     statement's result set — the database hashes it in flight and stores only
--     the digest. If you lose it, mint another and revoke the old one; there is
--     no "show token" anywhere, by design.
--
-- ─── WHY `MATERIALIZED` IS NOT DECORATION ───────────────────────────────────
--  gen_random_bytes() is VOLATILE and the `minted` CTE is referenced TWICE:
--  once to insert the hash, once to return the plaintext. Without MATERIALIZED,
--  the planner is free to inline the CTE and re-evaluate it per reference —
--  hashing a DIFFERENT token than the one it hands you. The pasted token would
--  then 401 forever with nothing anywhere to explain why. Do not remove it.
--
-- ─── SAFETY ─────────────────────────────────────────────────────────────────
--  * The token is 'd247_turo_' + 64 hex chars = 74 chars, carrying 256 bits of
--    entropy from gen_random_bytes(32). Not guessable.
--  * It is a BEARER credential scoped to exactly one tenant. Anyone holding it
--    can write Turo reservations into that tenant and nothing else — it grants
--    no read access, no portal session, and no reach into any other tenant.
--  * Treat it like a password: do not paste it into a shared doc, a ticket, or
--    a screen share. Revoke and re-mint if it is ever shown on stage.
--  * `extensions.digest` / `gen_random_bytes` are schema-qualified because
--    pgcrypto is installed WITH SCHEMA extensions in this project
--    (20251219083413_remote_schema.sql:48) and is not on the default search_path.
-- ============================================================================

WITH minted AS MATERIALIZED (
  SELECT
    t.id AS tenant_id,
    t.slug AS tenant_slug,
    'd247_turo_' || encode(extensions.gen_random_bytes(32), 'hex') AS token
  FROM public.tenants t
  WHERE t.slug = 'test'          -- <<< CHANGE ME to the demo tenant's slug
  LIMIT 1
),
inserted AS (
  INSERT INTO public.turo_bridge_tokens (tenant_id, token_hash, token_prefix, label)
  SELECT
    m.tenant_id,
    encode(extensions.digest(m.token, 'sha256'), 'hex'),  -- only the digest is stored
    left(m.token, 14),                                    -- 'd247_turo_' + 4 chars
    'Turo Bridge — demo laptop'
  FROM minted m
  RETURNING id, tenant_id, token_prefix, created_at
)
SELECT
  m.token         AS paste_this_into_the_extension,
  m.tenant_slug   AS tenant,
  i.token_prefix  AS identify_it_later_by,
  i.tenant_id,
  i.id            AS token_row_id,
  i.created_at
FROM inserted i
CROSS JOIN minted m;

-- If the result is EMPTY, no tenant matched the slug on the marked line.
-- List the candidates with:
--   SELECT slug, company_name FROM public.tenants ORDER BY slug;

-- ============================================================================
-- REVOKE (the token stops working on the very next request — the edge function
-- checks revoked_at on every call)
-- ============================================================================
-- UPDATE public.turo_bridge_tokens
--    SET revoked_at = now()
--  WHERE token_prefix = 'd247_turo_ab12';   -- from identify_it_later_by

-- ============================================================================
-- LIST what exists, without exposing anything (safe to run on a shared screen)
-- ============================================================================
-- SELECT t.token_prefix, t.label, tn.slug AS tenant, t.created_at,
--        t.last_used_at, t.revoked_at
--   FROM public.turo_bridge_tokens t
--   JOIN public.tenants tn ON tn.id = t.tenant_id
--  ORDER BY t.created_at DESC;
