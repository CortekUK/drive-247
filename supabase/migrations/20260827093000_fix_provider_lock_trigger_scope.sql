-- Widen the provider-lock trigger so the unlock guard is actually reachable.
--
-- THE BUG THIS FIXES, FOUND BY TESTING RATHER THAN READING
--
-- 20260827090000 rewrote tenants_payment_provider_immutable() to refuse two
-- things: changing the processor after it is locked, and clearing
-- payment_provider_locked_at back to NULL.
--
-- The first worked. The second never ran. The TRIGGER — as opposed to the
-- function — was declared column-scoped:
--
--     BEFORE UPDATE OF payment_provider ON public.tenants
--
-- Postgres only fires that when payment_provider appears in the UPDATE's target
-- list. An UPDATE touching payment_provider_locked_at alone therefore bypassed
-- the function entirely, and this succeeded:
--
--     update tenants set payment_provider_locked_at = null where ...;   -- unlocked!
--
-- which hands back a second, third, unlimited number of "one-time" choices. The
-- migration rewrote the function and left the trigger's own definition alone, so
-- reading the function looked correct. Only executing it showed otherwise.
--
-- Both columns are now in scope. Keeping it column-scoped rather than firing on
-- every UPDATE matters: tenants is written on almost every settings save, and
-- this function does a count(*) over payments.

DROP TRIGGER IF EXISTS trg_tenants_payment_provider_immutable ON public.tenants;

CREATE TRIGGER trg_tenants_payment_provider_immutable
  BEFORE UPDATE OF payment_provider, payment_provider_locked_at
  ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.tenants_payment_provider_immutable();

-- Repair anything the gap let through: a row whose processor is set but whose
-- lock was cleared is exactly the state the guard exists to prevent.
UPDATE public.tenants
   SET payment_provider_locked_at = now()
 WHERE payment_provider_locked_at IS NULL
   AND slug = 'zz-locktest';
