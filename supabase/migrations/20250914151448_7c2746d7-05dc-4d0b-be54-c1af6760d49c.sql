-- Phase 1: Database enhancements for insurance management

-- Add docs_count field to insurance_policies table for performance
ALTER TABLE public.insurance_policies 
ADD COLUMN IF NOT EXISTS docs_count INTEGER DEFAULT 0;

-- Add unique constraint for policy_number per customer
ALTER TABLE public.insurance_policies
ADD CONSTRAINT unique_policy_number_per_customer 
UNIQUE (customer_id, policy_number);

-- Create function to update docs_count when documents are added/removed
CREATE OR REPLACE FUNCTION public.update_insurance_docs_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE insurance_policies 
    SET docs_count = docs_count + 1 
    WHERE id = NEW.policy_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE insurance_policies 
    SET docs_count = docs_count - 1 
    WHERE id = OLD.policy_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for docs_count maintenance
DROP TRIGGER IF EXISTS trigger_update_insurance_docs_count ON public.insurance_documents;
CREATE TRIGGER trigger_update_insurance_docs_count
  AFTER INSERT OR DELETE ON public.insurance_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_insurance_docs_count();

-- Backfill existing docs_count values
UPDATE insurance_policies 
SET docs_count = (
  SELECT COUNT(*) 
  FROM insurance_documents 
  WHERE insurance_documents.policy_id = insurance_policies.id
);

-- Function to check for overlapping active policies
CREATE OR REPLACE FUNCTION public.check_policy_overlap(
  p_customer_id UUID,
  p_vehicle_id UUID,
  p_start_date DATE,
  p_expiry_date DATE,
  p_policy_id UUID DEFAULT NULL
) RETURNS TABLE(
  overlapping_policy_id UUID,
  overlapping_policy_number TEXT,
  overlapping_start_date DATE,
  overlapping_expiry_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ip.id,
    ip.policy_number,
    ip.start_date,
    ip.expiry_date
  FROM insurance_policies ip
  WHERE ip.customer_id = p_customer_id
    AND (ip.vehicle_id = p_vehicle_id OR (ip.vehicle_id IS NULL AND p_vehicle_id IS NULL))
    AND ip.status = 'Active'
    AND (p_policy_id IS NULL OR ip.id != p_policy_id)
    AND (
      (ip.start_date <= p_start_date AND ip.expiry_date >= p_start_date) OR
      (ip.start_date <= p_expiry_date AND ip.expiry_date >= p_expiry_date) OR
      (p_start_date <= ip.start_date AND p_expiry_date >= ip.expiry_date)
    );
END;
$$ LANGUAGE plpgsql;

-- Function to recalculate insurance policy status based on dates
CREATE OR REPLACE FUNCTION public.recalculate_insurance_status()
RETURNS TABLE(
  updated_policies INTEGER,
  expired_policies INTEGER,
  expiring_soon_policies INTEGER
) AS $$
DECLARE
  v_updated INTEGER := 0;
  v_expired INTEGER := 0;
  v_expiring_soon INTEGER := 0;
  policy_record RECORD;
  new_status TEXT;
BEGIN
  -- Process all non-Inactive policies
  FOR policy_record IN 
    SELECT id, status, expiry_date, start_date
    FROM insurance_policies 
    WHERE status != 'Inactive'
  LOOP
    -- Calculate new status based on dates
    IF policy_record.expiry_date < CURRENT_DATE THEN
      new_status := 'Expired';
      v_expired := v_expired + 1;
    ELSIF policy_record.expiry_date <= CURRENT_DATE + INTERVAL '30 days' 
          AND policy_record.expiry_date >= CURRENT_DATE THEN
      new_status := 'ExpiringSoon';
      v_expiring_soon := v_expiring_soon + 1;
    ELSIF policy_record.start_date <= CURRENT_DATE 
          AND policy_record.expiry_date >= CURRENT_DATE THEN
      new_status := 'Active';
    ELSE
      -- Future policy
      new_status := 'Active';
    END IF;
    
    -- Update if status changed
    IF policy_record.status != new_status THEN
      UPDATE insurance_policies 
      SET status = new_status, updated_at = NOW()
      WHERE id = policy_record.id;
      
      v_updated := v_updated + 1;
      
      -- Log the status change (simple audit trail)
      INSERT INTO vehicle_events (
        vehicle_id, 
        event_type, 
        summary, 
        reference_id, 
        reference_table
      ) VALUES (
        (SELECT vehicle_id FROM insurance_policies WHERE id = policy_record.id),
        'insurance_status_change',
        'Insurance policy status changed from ' || policy_record.status || ' to ' || new_status,
        policy_record.id,
        'insurance_policies'
      );
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_updated, v_expired, v_expiring_soon;
END;
$$ LANGUAGE plpgsql;