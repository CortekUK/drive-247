-- Let the TENANT choose their payment processor — once.
--
-- WHAT CHANGES
--
-- Until now the processor was stamped at company creation by a super admin and
-- frozen forever by trg_tenants_payment_provider_immutable. The tenant never had
-- a say: by the time they first logged in the value was already set and locked.
--
-- The rule now has two stages instead of one:
--
--   1. UNLOCKED — the super admin's choice at creation is a DEFAULT. The tenant
--      can change it exactly once from their own portal.
--   2. LOCKED   — the moment they confirm, it is permanent. Same guarantee as
--      before: no toggle, no second change, no migration path.
--
-- WHY A COLUMN AND NOT A COUNTER
--
-- `payment_provider_locked_at` records WHEN the decision became final, which is
-- the thing support actually needs when a tenant says "I never chose Square".
-- A boolean would answer "is it locked" but not "who was looking at what, when".
--
-- THE 52 EXISTING TENANTS ARE BACKFILLED AS LOCKED.
--
-- This is the load-bearing half of the migration. They are live, on Stripe, with
-- real money and real refunds outstanding. Leaving them unlocked would hand every
-- existing operator a one-click way to strand their own refunds on a rail their
-- payments were never taken on. They keep exactly today's behaviour.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payment_provider_locked_at timestamptz;

COMMENT ON COLUMN public.tenants.payment_provider_locked_at IS
  'When the payment processor choice became permanent. NULL means the tenant may still change it once from their portal. Set automatically by tenants_payment_provider_immutable(); never write it back to NULL.';

-- Every tenant that exists TODAY is already committed to its rail.
-- created_at, not now(), so the audit trail reads truthfully: these were
-- effectively locked from birth under the old one-stage rule.
UPDATE public.tenants
   SET payment_provider_locked_at = created_at
 WHERE payment_provider_locked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. The trigger — two stages instead of "never"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenants_payment_provider_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_payments integer;
BEGIN
  -- Unlocking is never legitimate. Without this the whole guarantee is one
  -- UPDATE away from being undone, and "permanent" would mean nothing.
  IF OLD.payment_provider_locked_at IS NOT NULL
     AND NEW.payment_provider_locked_at IS NULL THEN
    RAISE EXCEPTION
      'tenants.payment_provider_locked_at cannot be cleared; the processor choice is permanent once made'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN

    -- Stage 2: already decided.
    IF OLD.payment_provider_locked_at IS NOT NULL THEN
      RAISE EXCEPTION
        'tenants.payment_provider is locked (% -> %); it was chosen on % and cannot be changed again',
        OLD.payment_provider, NEW.payment_provider, OLD.payment_provider_locked_at
        USING ERRCODE = '23514';
    END IF;

    -- Stage 1, with one hard guard: money already taken pins the rail.
    --
    -- A refund MUST be issued on the processor that took the charge — that is
    -- why tryProviderRefund routes on the payment row and not on the tenant.
    -- Switching a tenant that already holds payments would leave those refunds
    -- with no reachable connection, and the operator would discover it only when
    -- a customer asked for their money back.
    SELECT count(*) INTO v_payments
      FROM public.payments
     WHERE tenant_id = NEW.id;

    IF v_payments > 0 THEN
      RAISE EXCEPTION
        'tenants.payment_provider cannot be changed: % payment(s) already exist on the % rail, and refunds must be issued on the processor that took them',
        v_payments, OLD.payment_provider
        USING ERRCODE = '23514';
    END IF;

    -- The choice is now final. Stamped HERE, not by the caller, so no client can
    -- change the provider while quietly leaving it unlocked for a second go.
    NEW.payment_provider_locked_at := now();
  END IF;

  RETURN NEW;
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Confirming without changing must lock too
-- ---------------------------------------------------------------------------
-- A tenant who keeps the default has still DECIDED. The trigger above only fires
-- on a change, so the portal stamps locked_at itself in that case — and the
-- unlock guard above stops that stamp being walked back later.

COMMENT ON FUNCTION public.tenants_payment_provider_immutable() IS
  'Two-stage lock on tenants.payment_provider: changeable once while payment_provider_locked_at IS NULL and the tenant holds no payments; permanent thereafter.';
