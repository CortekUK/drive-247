-- PHASE 1: Schema Updates for Admin-Controlled Fines Workflow
-- Add status tracking columns to fines table

-- Add new status tracking columns
ALTER TABLE public.fines 
ADD COLUMN IF NOT EXISTS charged_at timestamptz,
ADD COLUMN IF NOT EXISTS waived_at timestamptz,
ADD COLUMN IF NOT EXISTS appealed_at timestamptz,
ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Update the status check constraint to include new values
ALTER TABLE public.fines 
DROP CONSTRAINT IF EXISTS fines_status_check;

ALTER TABLE public.fines 
ADD CONSTRAINT fines_status_check 
CHECK (status IN ('Open', 'Appealed', 'Waived', 'Charged', 'Paid', 'Appeal Successful', 'Appeal Rejected', 'Appeal Submitted', 'Partially Paid'));

-- Ensure unique payment applications index exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_app_unique
ON payment_applications (payment_id, charge_entry_id);

-- PHASE 2: Remove Auto-Charging Behavior
-- Update the trigger to only charge Business liability fines immediately
-- Customer liability fines will be recorded but not charged until admin action

CREATE OR REPLACE FUNCTION public.trigger_create_fine_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only create ledger charge if liability is Business (immediate business cost)
  -- Customer liability fines are now recorded but not charged until admin action
  IF NEW.liability = 'Business' THEN
    -- Create P&L cost entry for business liability fines
    INSERT INTO pnl_entries(
      vehicle_id, 
      entry_date, 
      side, 
      category, 
      amount, 
      source_ref,
      customer_id
    )
    VALUES (
      NEW.vehicle_id, 
      NEW.issue_date, 
      'Cost', 
      'Fines', 
      NEW.amount, 
      NEW.id::text,
      NEW.customer_id
    )
    ON CONFLICT (vehicle_id, category, source_ref) DO UPDATE SET
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date;
  END IF;
  
  -- Customer liability fines are just recorded, no automatic charging
  -- They will be charged later via the apply-fine edge function
  
  RETURN NEW;
END $function$;