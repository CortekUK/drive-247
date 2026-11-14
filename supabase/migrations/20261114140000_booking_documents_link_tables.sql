-- APPLIED to production 2026-11-14 (QA I2, branch Insurance-testing)
--
-- The post-payment documents link: after a booking is paid, the customer gets a
-- link (/booking/documents/<token>) to send their insurance certificate. The
-- booking site page for it was live, but its tables and the
-- booking-documents-link function only ever existed on staging
-- (haseeb/staging/booking-side, no migration file). Shapes are taken from how
-- that code reads and writes them.
--
--   booking_document_links  one durable link per rental (UNIQUE rental_id),
--                           7 days, slid on every visit/upload; also carries the
--                           identity step's state (identity_*).
--   booking_email_dispatch  the booking email outbox. booking-documents-link's
--                           "send me a new link" queues a row here
--                           (UNIQUE idempotency_key, bucketed per minute).
--
-- Both are service-role only: RLS on, no policies. The token is a bearer
-- credential, so no browser reads either table directly; every access goes
-- through the edge function with the service key.
--
-- Rollback: DROP TABLE public.booking_email_dispatch; DROP TABLE public.booking_document_links;

CREATE TABLE IF NOT EXISTS public.booking_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  identity_session_id text,
  identity_status text NOT NULL DEFAULT 'pending'
    CHECK (identity_status IN ('pending', 'submitted', 'rejected')),
  identity_started_at timestamptz,
  identity_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_document_links_rental_unique UNIQUE (rental_id),
  CONSTRAINT booking_document_links_token_unique UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS booking_document_links_tenant_idx ON public.booking_document_links (tenant_id);
ALTER TABLE public.booking_document_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.booking_email_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  email_key text NOT NULL
    CHECK (email_key IN ('booking_pending', 'booking_documents_required', 'booking_documents_received')),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  provider_message_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_email_dispatch_idempotency_unique UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS booking_email_dispatch_rental_idx ON public.booking_email_dispatch (rental_id, email_key);
CREATE INDEX IF NOT EXISTS booking_email_dispatch_pending_idx ON public.booking_email_dispatch (status, created_at) WHERE status IN ('pending', 'failed');
ALTER TABLE public.booking_email_dispatch ENABLE ROW LEVEL SECURITY;
