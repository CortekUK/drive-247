-- Multi Chat §1 (security): close public read/write of conversations,
-- voicemails and storage objects.
--
-- WHAT WAS OPEN (verified against production 2026-10-19 with the public anon
-- key and a real customer session):
--   * chat_channels / chat_channel_messages had RLS DISABLED (by
--     20260209120001_disable_rls_all_tables.sql) while anon + authenticated held
--     full table grants. Anyone with the anon key read all 342 messages of every
--     tenant (SMS, email, call and voicemail metadata) and could INSERT a message
--     as sender_type='tenant' into any customer's thread. Both tables are in the
--     supabase_realtime publication, so new rows also streamed to any listener.
--   * voicemail_recordings carried "Service role manages voicemails" FOR ALL
--     USING (true) with no TO clause, i.e. granted to PUBLIC.
--   * storage bucket `voicemails` was public, and storage.objects carried
--     "Enable read access for all users" FOR SELECT USING (true) — not scoped to
--     any bucket — so EVERY private bucket was listable/downloadable with the
--     anon key. Permissive policies OR together, so no bucket-scoped policy
--     could ever narrow that. Every private bucket that app code reads already
--     has its own scoped SELECT policy (audited 2026-10-19), so dropping it only
--     removes the over-grant.
--
-- WHAT STAYS WORKING
--   * Portal staff: read/insert in their own tenant's channels; mark-read.
--     Super admins: every tenant (is_super_admin carries tenant_id NULL).
--   * Customers (booking app): read their own channel, create their own
--     channel, send in_app messages AS THEMSELVES, mark-read.
--   * Edge functions use service_role, which bypasses RLS.
--   * Triggers that write chat rows (create_chat_channel_for_customer,
--     notify_new_chat_message) are SECURITY DEFINER — unaffected.
--   * Realtime postgres_changes now delivers only rows the subscriber may SELECT,
--     which is what makes the portal's tenant-wide subscription safe.
--
-- Rollback: 20261019160000_multichat_sec_chat_voicemail_rls.rollback.sql.txt
-- APPLIED to production 2026-10-19.

BEGIN;

-- ── helpers (SECURITY DEFINER so policies do not depend on the RLS state of
--    app_users / customer_users / customers) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_auth_customer_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cu.customer_id FROM public.customer_users cu WHERE cu.auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.chat_staff_can_access_tenant(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
     WHERE au.auth_user_id = auth.uid()
       AND au.is_active
       AND (au.is_super_admin OR au.tenant_id = p_tenant_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.chat_staff_can_access_channel(p_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels cc
      JOIN public.app_users au ON au.auth_user_id = auth.uid() AND au.is_active
     WHERE cc.id = p_channel_id
       AND (au.is_super_admin OR au.tenant_id = cc.tenant_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.chat_customer_can_access_channel(p_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels cc
      JOIN public.customer_users cu ON cu.customer_id = cc.customer_id
     WHERE cc.id = p_channel_id AND cu.auth_user_id = auth.uid()
  );
$$;

-- A customer may only open a channel for themselves, inside their own tenant.
CREATE OR REPLACE FUNCTION public.chat_customer_owns_pair(p_customer_id uuid, p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_users cu
      JOIN public.customers c ON c.id = cu.customer_id
     WHERE cu.auth_user_id = auth.uid()
       AND cu.customer_id = p_customer_id
       AND c.tenant_id = p_tenant_id
  );
$$;

REVOKE ALL ON FUNCTION public.chat_auth_customer_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_staff_can_access_tenant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_staff_can_access_channel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_customer_can_access_channel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_customer_owns_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_auth_customer_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_staff_can_access_tenant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_staff_can_access_channel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_customer_can_access_channel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_customer_owns_pair(uuid, uuid) TO authenticated, service_role;

-- ── grants: anon gets nothing; authenticated gets exactly what the apps use ──

REVOKE ALL ON public.chat_channels, public.chat_channel_messages, public.chat_channel_participants FROM anon;
REVOKE ALL ON public.chat_channels, public.chat_channel_messages, public.chat_channel_participants FROM authenticated;
GRANT SELECT, INSERT ON public.chat_channels TO authenticated;
GRANT UPDATE (last_message_at, updated_at, last_channel, status) ON public.chat_channels TO authenticated;
GRANT SELECT, INSERT ON public.chat_channel_messages TO authenticated;
-- Clients only ever mark messages read. Delivery status, content and metadata
-- are written by edge functions (service_role).
GRANT UPDATE (is_read, read_at) ON public.chat_channel_messages TO authenticated;
-- chat_channel_participants: no code reads or writes it; leave it closed.

-- ── chat_channels ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Customers can read own channels" ON public.chat_channels;
DROP POLICY IF EXISTS "Portal users can create tenant channels" ON public.chat_channels;
DROP POLICY IF EXISTS "Portal users can read tenant channels" ON public.chat_channels;
DROP POLICY IF EXISTS "Portal users can update tenant channels" ON public.chat_channels;

CREATE POLICY chat_channels_staff_select ON public.chat_channels
  FOR SELECT TO authenticated USING (public.chat_staff_can_access_tenant(tenant_id));
CREATE POLICY chat_channels_staff_insert ON public.chat_channels
  FOR INSERT TO authenticated WITH CHECK (public.chat_staff_can_access_tenant(tenant_id));
CREATE POLICY chat_channels_staff_update ON public.chat_channels
  FOR UPDATE TO authenticated
  USING (public.chat_staff_can_access_tenant(tenant_id))
  WITH CHECK (public.chat_staff_can_access_tenant(tenant_id));

CREATE POLICY chat_channels_customer_select ON public.chat_channels
  FOR SELECT TO authenticated USING (customer_id IN (SELECT public.chat_auth_customer_ids()));
CREATE POLICY chat_channels_customer_insert ON public.chat_channels
  FOR INSERT TO authenticated WITH CHECK (public.chat_customer_owns_pair(customer_id, tenant_id));
CREATE POLICY chat_channels_customer_update ON public.chat_channels
  FOR UPDATE TO authenticated
  USING (customer_id IN (SELECT public.chat_auth_customer_ids()))
  WITH CHECK (customer_id IN (SELECT public.chat_auth_customer_ids()));

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

-- ── chat_channel_messages ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Customers can read own messages" ON public.chat_channel_messages;
DROP POLICY IF EXISTS "Customers can send own messages" ON public.chat_channel_messages;
DROP POLICY IF EXISTS "Customers can update own messages" ON public.chat_channel_messages;
DROP POLICY IF EXISTS "Portal users can read tenant messages" ON public.chat_channel_messages;
DROP POLICY IF EXISTS "Portal users can send tenant messages" ON public.chat_channel_messages;
DROP POLICY IF EXISTS "Portal users can update tenant messages" ON public.chat_channel_messages;

CREATE POLICY chat_messages_staff_select ON public.chat_channel_messages
  FOR SELECT TO authenticated USING (public.chat_staff_can_access_channel(channel_id));
-- Staff may insert any sender_type: linking an unknown SMS thread copies the
-- customer's inbound texts into the channel (LinkUnknownThreadDialog).
CREATE POLICY chat_messages_staff_insert ON public.chat_channel_messages
  FOR INSERT TO authenticated WITH CHECK (public.chat_staff_can_access_channel(channel_id));
CREATE POLICY chat_messages_staff_update ON public.chat_channel_messages
  FOR UPDATE TO authenticated
  USING (public.chat_staff_can_access_channel(channel_id))
  WITH CHECK (public.chat_staff_can_access_channel(channel_id));

CREATE POLICY chat_messages_customer_select ON public.chat_channel_messages
  FOR SELECT TO authenticated USING (public.chat_customer_can_access_channel(channel_id));
-- A customer speaks only as themselves, only in-app, only in their own thread.
CREATE POLICY chat_messages_customer_insert ON public.chat_channel_messages
  FOR INSERT TO authenticated WITH CHECK (
    public.chat_customer_can_access_channel(channel_id)
    AND sender_type = 'customer'
    AND sender_id IN (SELECT public.chat_auth_customer_ids())
    AND COALESCE(channel, 'in_app') = 'in_app'
    AND external_id IS NULL
    AND external_status IS NULL
  );
CREATE POLICY chat_messages_customer_update ON public.chat_channel_messages
  FOR UPDATE TO authenticated
  USING (public.chat_customer_can_access_channel(channel_id))
  WITH CHECK (public.chat_customer_can_access_channel(channel_id));

ALTER TABLE public.chat_channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_participants ENABLE ROW LEVEL SECURITY;

-- ── voicemail_recordings ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Service role manages voicemails" ON public.voicemail_recordings;
REVOKE ALL ON public.voicemail_recordings FROM anon;
REVOKE ALL ON public.voicemail_recordings FROM authenticated;
GRANT SELECT ON public.voicemail_recordings TO authenticated;
-- "Tenant users can view voicemails" (tenant_id = get_user_tenant_id() OR
-- is_super_admin()) remains the only non-service policy.

-- ── storage ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Enable read access for all users" ON storage.objects;

UPDATE storage.buckets SET public = false WHERE id = 'voicemails';

DROP POLICY IF EXISTS "Tenant users can read voicemails" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload voicemails" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete voicemails" ON storage.objects;

-- Storage objects are keyed <tenant_id>/<file>. Compared as text so an object
-- whose first segment is not a UUID simply does not match (a ::uuid cast would
-- throw and fail the whole list call).
CREATE OR REPLACE FUNCTION public.storage_staff_can_access_folder(p_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
     WHERE au.auth_user_id = auth.uid()
       AND au.is_active
       AND (au.is_super_admin OR au.tenant_id::text = p_folder)
  );
$$;
REVOKE ALL ON FUNCTION public.storage_staff_can_access_folder(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_staff_can_access_folder(text) TO authenticated, service_role;

-- Recordings and voicemails: objects live at <tenant_id>/<file>.
CREATE POLICY voicemails_staff_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'voicemails'
         AND public.storage_staff_can_access_folder((storage.foldername(name))[1]));

-- Voicemail greetings are played by Twilio <Play>, which needs an unauthenticated
-- URL, so they get their own PUBLIC bucket that holds nothing but greetings.
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-greetings', 'voice-greetings', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY voice_greetings_staff_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'voice-greetings'
         AND public.storage_staff_can_access_folder((storage.foldername(name))[1]));
CREATE POLICY voice_greetings_staff_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voice-greetings'
              AND public.storage_staff_can_access_folder((storage.foldername(name))[1]));
CREATE POLICY voice_greetings_staff_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'voice-greetings'
         AND public.storage_staff_can_access_folder((storage.foldername(name))[1]));
CREATE POLICY voice_greetings_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'voice-greetings'
         AND public.storage_staff_can_access_folder((storage.foldername(name))[1]));

COMMIT;
