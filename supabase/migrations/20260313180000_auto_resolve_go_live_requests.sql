-- Auto-resolve go-live requests when admin changes integration mode on tenants table.
-- When stripe_mode, bonzah_mode, or boldsign_mode changes, auto-approve/resolve
-- the matching pending request for that tenant + integration.

CREATE OR REPLACE FUNCTION auto_resolve_go_live_requests()
RETURNS TRIGGER AS $$
BEGIN
  -- Stripe Connect: mode changed
  IF OLD.stripe_mode IS DISTINCT FROM NEW.stripe_mode THEN
    UPDATE go_live_requests
    SET status = 'approved',
        reviewed_at = now(),
        admin_note = 'Auto-approved: mode changed to ' || NEW.stripe_mode
    WHERE tenant_id = NEW.id
      AND integration_type = 'stripe_connect'
      AND status = 'pending';
  END IF;

  -- Bonzah: mode changed
  IF OLD.bonzah_mode IS DISTINCT FROM NEW.bonzah_mode THEN
    UPDATE go_live_requests
    SET status = 'approved',
        reviewed_at = now(),
        admin_note = 'Auto-approved: mode changed to ' || NEW.bonzah_mode
    WHERE tenant_id = NEW.id
      AND integration_type = 'bonzah'
      AND status = 'pending';
  END IF;

  -- BoldSign: mode changed
  IF OLD.boldsign_mode IS DISTINCT FROM NEW.boldsign_mode THEN
    UPDATE go_live_requests
    SET status = 'approved',
        reviewed_at = now(),
        admin_note = 'Auto-approved: mode changed to ' || NEW.boldsign_mode
    WHERE tenant_id = NEW.id
      AND integration_type = 'boldsign'
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_resolve_go_live_requests
  AFTER UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION auto_resolve_go_live_requests();
