-- Per-call OpenAI API usage tracking.
-- Written by edge functions via service role, readable only by super admins.

CREATE TABLE public.openai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  function_name TEXT NOT NULL,
  endpoint TEXT NOT NULL CHECK (endpoint IN ('chat/completions','embeddings','audio/transcriptions','images/generations')),
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','error')),
  is_fallback BOOLEAN NOT NULL DEFAULT false,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_openai_usage_logs_created_at ON public.openai_usage_logs(created_at DESC);
CREATE INDEX idx_openai_usage_logs_tenant ON public.openai_usage_logs(tenant_id, created_at DESC);
CREATE INDEX idx_openai_usage_logs_function ON public.openai_usage_logs(function_name, created_at DESC);
CREATE INDEX idx_openai_usage_logs_model ON public.openai_usage_logs(model, created_at DESC);

ALTER TABLE public.openai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admins_can_select_openai_usage_logs"
  ON public.openai_usage_logs FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "service_role_can_insert_openai_usage_logs"
  ON public.openai_usage_logs FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE public.openai_usage_logs IS 'Per-call OpenAI API usage tracking. Written by edge functions via service role, readable only by super admins.';
