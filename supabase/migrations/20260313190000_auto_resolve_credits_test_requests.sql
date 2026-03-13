-- Auto-resolve credits_test go-live requests when test_balance increases on tenant_credit_wallets.
-- When an admin tops up a tenant's test credits, the pending request is auto-approved.

CREATE OR REPLACE FUNCTION auto_resolve_credits_test_requests()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.test_balance > OLD.test_balance THEN
    UPDATE go_live_requests
    SET status = 'approved',
        reviewed_at = now(),
        admin_note = 'Auto-approved: test credits topped up'
    WHERE tenant_id = NEW.tenant_id
      AND integration_type = 'credits_test'
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_resolve_credits_test_requests
  AFTER UPDATE ON tenant_credit_wallets
  FOR EACH ROW
  EXECUTE FUNCTION auto_resolve_credits_test_requests();
