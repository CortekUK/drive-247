-- Trigger function: sync verified name from identity_verifications to customers.name
CREATE OR REPLACE FUNCTION sync_verified_name_to_customer()
RETURNS TRIGGER AS $$
DECLARE
  verified_name TEXT;
BEGIN
  -- Only sync when verification is approved (GREEN) and name data exists
  IF NEW.review_result = 'GREEN' AND NEW.customer_id IS NOT NULL
     AND (NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL) THEN

    verified_name := TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name));

    IF verified_name <> '' THEN
      UPDATE customers
      SET name = verified_name
      WHERE id = NEW.customer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fires on INSERT or UPDATE of identity_verifications
CREATE TRIGGER trigger_sync_verified_name
  AFTER INSERT OR UPDATE ON identity_verifications
  FOR EACH ROW
  EXECUTE FUNCTION sync_verified_name_to_customer();
