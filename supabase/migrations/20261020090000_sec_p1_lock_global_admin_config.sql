-- Platform security P1 (docs/security/01-platform-findings.md): lock the global
-- master password table.
--
-- WHAT WAS OPEN (verified against production 2026-10-20 with the public anon key):
--   * global_admin_config had RLS OFF and anon + authenticated held ALL privileges.
--     An anon GET returned both master accounts' password hashes (offline
--     cracking), and a zero-row anon PATCH was accepted, i.e. the hash could be
--     overwritten with one of the attacker's choosing.
--   * verify_global_master_password(email, password) was EXECUTE-able by anon:
--     an unauthenticated, unthrottled password-guessing oracle.
--
-- WHY NOTHING BREAKS: no app reads this table or calls the function. The only
-- caller is the master-password-login edge function, which uses service_role;
-- the function is SECURITY DEFINER owned by postgres (the table owner), so it
-- keeps reading the table with RLS on and no policies.
--
-- Rollback: 20261020090000_sec_p1_lock_global_admin_config.rollback.sql.txt
-- APPLIED to production 2026-10-20.

BEGIN;

REVOKE ALL ON public.global_admin_config FROM anon, authenticated;
ALTER TABLE public.global_admin_config ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only service_role (bypasses RLS) and the table
-- owner (the SECURITY DEFINER verifier) may touch it.

REVOKE ALL ON FUNCTION public.verify_global_master_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_global_master_password(text, text) TO service_role;

COMMIT;
