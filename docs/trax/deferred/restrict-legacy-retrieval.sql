-- DEFERRED PROPOSAL ONLY. Outside migrations: this would affect V1 globally.
-- Not included in the V2-only rollout; separate approval is required.
-- New TRAX uses prepared product documentation and browser-memory conversations.
-- Do not delete, reindex or migrate the contents of these sensitive stores.
-- Verify deployed callers, grants and definitions before an approved rollout.
BEGIN;

REVOKE ALL ON TABLE public.rag_documents, public.rag_sync_queue, public.chat_messages
  FROM PUBLIC, anon, authenticated;

-- Close direct RPC bypasses of the authorized Edge Function. Enumerate actual
-- overload signatures so vector extension placement/typmods do not cause a miss.
DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('match_documents', 'get_chat_history', 'get_rag_metrics')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', candidate.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', candidate.signature);
  END LOOP;
END;
$$;

COMMIT;
