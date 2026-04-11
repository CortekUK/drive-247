-- Auto-create chat_channels for every customer
--
-- Problem: chat_channels rows were only created lazily from the booking
-- customer portal (apps/booking/src/contexts/CustomerRealtimeChatContext.tsx),
-- so operators could not see a customer in the portal Messages tab until
-- that customer had opened the chat themselves. Most customers never do.
--
-- Fix:
--   1. Trigger on customers INSERT → auto-create a matching chat_channels row
--   2. One-shot backfill for every existing customer that is missing a channel

-- ----------------------------------------------------------------------------
-- 1. Trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_chat_channel_for_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chat_channels (tenant_id, customer_id, status)
  VALUES (NEW.tenant_id, NEW.id, 'active')
  ON CONFLICT (tenant_id, customer_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_chat_channel_for_customer() IS
  'Auto-creates a chat_channels row whenever a new customer is inserted, so operators can message them immediately from the portal Messages tab.';

-- ----------------------------------------------------------------------------
-- 2. Trigger on customers INSERT
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS customers_create_chat_channel ON public.customers;

CREATE TRIGGER customers_create_chat_channel
  AFTER INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.create_chat_channel_for_customer();

-- ----------------------------------------------------------------------------
-- 3. Backfill: create channels for existing customers that don't have one
-- ----------------------------------------------------------------------------
INSERT INTO public.chat_channels (tenant_id, customer_id, status)
SELECT c.tenant_id, c.id, 'active'
FROM public.customers c
LEFT JOIN public.chat_channels ch
  ON ch.tenant_id = c.tenant_id
 AND ch.customer_id = c.id
WHERE ch.id IS NULL
  AND c.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, customer_id) DO NOTHING;
