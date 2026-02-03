-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- RAG DOCUMENTS TABLE
-- Stores embeddings for semantic search across all indexed content
-- ============================================================================
CREATE TABLE rag_documents (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI text-embedding-ada-002 dimensions
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, source_table, source_id)
);

-- Create index for vector similarity search
-- Using ivfflat for efficient approximate nearest neighbor search
CREATE INDEX rag_documents_embedding_idx ON rag_documents
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Index for efficient lookups by tenant and source
CREATE INDEX rag_documents_tenant_source_idx ON rag_documents(tenant_id, source_table);

-- ============================================================================
-- RAG SYNC QUEUE TABLE
-- Tracks changes that need embedding updates (populated by triggers)
-- ============================================================================
CREATE TABLE rag_sync_queue (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Index for efficient queue processing
CREATE INDEX rag_sync_queue_unprocessed_idx ON rag_sync_queue(created_at)
    WHERE processed_at IS NULL;
CREATE INDEX rag_sync_queue_tenant_idx ON rag_sync_queue(tenant_id);

-- ============================================================================
-- CHAT MESSAGES TABLE
-- Stores conversation history for the RAG chatbot
-- ============================================================================
CREATE TABLE chat_messages (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    sources JSONB DEFAULT '[]',
    chart_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient message retrieval
CREATE INDEX chat_messages_conversation_idx ON chat_messages(tenant_id, conversation_id, created_at);
CREATE INDEX chat_messages_user_idx ON chat_messages(tenant_id, user_id, created_at);

-- ============================================================================
-- MATCH_DOCUMENTS RPC FUNCTION
-- Vector similarity search for retrieving relevant context
-- ============================================================================
CREATE OR REPLACE FUNCTION match_documents(
    p_tenant_id UUID,
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10,
    filter_tables TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    source_table TEXT,
    source_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        rd.id,
        rd.source_table,
        rd.source_id,
        rd.content,
        rd.metadata,
        1 - (rd.embedding <=> query_embedding) AS similarity
    FROM rag_documents rd
    WHERE rd.tenant_id = p_tenant_id
        AND (filter_tables IS NULL OR rd.source_table = ANY(filter_tables))
        AND 1 - (rd.embedding <=> query_embedding) > match_threshold
    ORDER BY rd.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- QUEUE_FOR_RAG TRIGGER FUNCTION
-- Automatically queues changes for RAG embedding updates
-- ============================================================================
CREATE OR REPLACE FUNCTION queue_for_rag()
RETURNS TRIGGER AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant_id from the record (all our tables have tenant_id)
    IF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
        INSERT INTO rag_sync_queue (tenant_id, source_table, source_id, action)
        VALUES (v_tenant_id, TG_TABLE_NAME, OLD.id::TEXT, 'DELETE');
        RETURN OLD;
    ELSE
        v_tenant_id := NEW.tenant_id;
        INSERT INTO rag_sync_queue (tenant_id, source_table, source_id, action)
        VALUES (v_tenant_id, TG_TABLE_NAME, NEW.id::TEXT, TG_OP);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CREATE TRIGGERS FOR TABLES TO INDEX
-- These tables will have their changes automatically queued for RAG sync
-- ============================================================================

-- Customers table trigger
CREATE TRIGGER customers_rag_trigger
    AFTER INSERT OR UPDATE OR DELETE ON customers
    FOR EACH ROW EXECUTE FUNCTION queue_for_rag();

-- Vehicles table trigger
CREATE TRIGGER vehicles_rag_trigger
    AFTER INSERT OR UPDATE OR DELETE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION queue_for_rag();

-- Rentals table trigger
CREATE TRIGGER rentals_rag_trigger
    AFTER INSERT OR UPDATE OR DELETE ON rentals
    FOR EACH ROW EXECUTE FUNCTION queue_for_rag();

-- Payments table trigger
CREATE TRIGGER payments_rag_trigger
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION queue_for_rag();

-- Fines table trigger
CREATE TRIGGER fines_rag_trigger
    AFTER INSERT OR UPDATE OR DELETE ON fines
    FOR EACH ROW EXECUTE FUNCTION queue_for_rag();

-- Plates table trigger
CREATE TRIGGER plates_rag_trigger
    AFTER INSERT OR UPDATE OR DELETE ON plates
    FOR EACH ROW EXECUTE FUNCTION queue_for_rag();

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RAG Documents policies (service role only for write, tenant users can read)
CREATE POLICY "Service role can manage rag_documents"
    ON rag_documents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Tenant users can read their rag_documents"
    ON rag_documents
    FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.id = auth.uid()
        )
    );

-- RAG Sync Queue policies (service role only)
CREATE POLICY "Service role can manage rag_sync_queue"
    ON rag_sync_queue
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Chat Messages policies
CREATE POLICY "Service role can manage chat_messages"
    ON chat_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users can read their own chat messages"
    ON chat_messages
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.id = auth.uid()
        )
    );

CREATE POLICY "Users can insert their own chat messages"
    ON chat_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.id = auth.uid()
        )
    );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get chat history for a conversation
CREATE OR REPLACE FUNCTION get_chat_history(
    p_tenant_id UUID,
    p_conversation_id UUID,
    p_limit INT DEFAULT 20
)
RETURNS TABLE (
    id BIGINT,
    role TEXT,
    content TEXT,
    sources JSONB,
    chart_data JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cm.id,
        cm.role,
        cm.content,
        cm.sources,
        cm.chart_data,
        cm.created_at
    FROM chat_messages cm
    WHERE cm.tenant_id = p_tenant_id
        AND cm.conversation_id = p_conversation_id
    ORDER BY cm.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Function to get aggregate metrics for RAG context
CREATE OR REPLACE FUNCTION get_rag_metrics(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id),
        'active_customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id AND status = 'active'),
        'total_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id),
        'available_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id AND status = 'available'),
        'active_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND status = 'active'),
        'total_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id),
        'pending_payments', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = p_tenant_id AND status = 'pending'),
        'total_fines', (SELECT COUNT(*) FROM fines WHERE tenant_id = p_tenant_id),
        'unpaid_fines', (SELECT COUNT(*) FROM fines WHERE tenant_id = p_tenant_id AND status != 'paid')
    ) INTO result;

    RETURN result;
END;
$$;
