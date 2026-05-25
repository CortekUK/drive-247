-- Revenue Optimiser Phase 4 — track every offer message we send out for a
-- combined recommendation. Used by the outcome screen to attribute conversions
-- and by the admin per-tenant dashboard to see offer activity.
CREATE TABLE IF NOT EXISTS public.revenue_optimiser_offer_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES public.pricing_recommendations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),

  /** Snapshot of message so we can render the offer history even if the lead/conversation is later deleted. */
  message_body TEXT,
  template_id UUID,

  /** Lifecycle: queued → sent | failed. Failure is captured in dispatch_error. */
  dispatch_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (dispatch_status IN ('queued', 'sent', 'failed')),
  dispatched_at TIMESTAMPTZ,
  dispatch_error TEXT,

  /** Outcome attribution: did this lead convert AFTER we dispatched? */
  converted_at TIMESTAMPTZ,
  converted_to_rental_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id, lead_id)
);

CREATE INDEX idx_offer_dispatches_rec ON public.revenue_optimiser_offer_dispatches(recommendation_id);
CREATE INDEX idx_offer_dispatches_tenant ON public.revenue_optimiser_offer_dispatches(tenant_id, created_at DESC);
CREATE INDEX idx_offer_dispatches_lead ON public.revenue_optimiser_offer_dispatches(lead_id);

CREATE TRIGGER set_offer_dispatches_updated_at
  BEFORE UPDATE ON public.revenue_optimiser_offer_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.revenue_optimiser_offer_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_offer_dispatches" ON public.revenue_optimiser_offer_dispatches
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_offer_dispatches" ON public.revenue_optimiser_offer_dispatches
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.revenue_optimiser_offer_dispatches IS 'Phase 4 — outbound offers triggered from a combined recommendation. Spec §16.';
