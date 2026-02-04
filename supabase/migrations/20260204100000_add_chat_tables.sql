-- Tenant-Customer Chat Module
-- Real-time messaging between tenants (portal operators) and customers

-- ============================================================================
-- CHAT CHANNELS TABLE
-- One channel per tenant-customer pair
-- ============================================================================
CREATE TABLE chat_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One channel per tenant-customer pair
    UNIQUE(tenant_id, customer_id)
);

-- Indexes for common queries
CREATE INDEX idx_chat_channels_tenant_id ON chat_channels(tenant_id);
CREATE INDEX idx_chat_channels_customer_id ON chat_channels(customer_id);
CREATE INDEX idx_chat_channels_last_message ON chat_channels(tenant_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_chat_channels_status ON chat_channels(tenant_id, status);

-- ============================================================================
-- CHAT CHANNEL MESSAGES TABLE
-- Stores all messages in a channel
-- ============================================================================
CREATE TABLE chat_channel_messages (
    id BIGSERIAL PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('tenant', 'customer')),
    sender_id UUID NOT NULL,  -- app_users.id for tenant, customers.id for customer
    content TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient message retrieval and unread counts
CREATE INDEX idx_chat_messages_channel_created ON chat_channel_messages(channel_id, created_at DESC);
CREATE INDEX idx_chat_messages_unread ON chat_channel_messages(channel_id, is_read) WHERE is_read = false;
CREATE INDEX idx_chat_messages_sender ON chat_channel_messages(sender_type, sender_id);

-- ============================================================================
-- CHAT CHANNEL PARTICIPANTS TABLE
-- Tracks participant-specific data like unread counts and mute settings
-- ============================================================================
CREATE TABLE chat_channel_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    participant_type TEXT NOT NULL CHECK (participant_type IN ('tenant', 'customer')),
    participant_id UUID NOT NULL,  -- app_users.id for tenant, customers.id for customer
    last_read_at TIMESTAMPTZ,
    unread_count INTEGER NOT NULL DEFAULT 0,
    is_muted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- One entry per participant per channel
    UNIQUE(channel_id, participant_type, participant_id)
);

-- Index for efficient participant lookups
CREATE INDEX idx_chat_participants_lookup ON chat_channel_participants(participant_type, participant_id);
CREATE INDEX idx_chat_participants_channel ON chat_channel_participants(channel_id);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_participants ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- CHAT CHANNELS POLICIES
-- ============================================================================

-- Service role has full access (for Socket.IO server)
CREATE POLICY "Service role has full access to chat_channels"
    ON chat_channels
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users (portal) can read their tenant's channels
CREATE POLICY "Portal users can read tenant channels"
    ON chat_channels
    FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Authenticated users can insert channels for their tenant
CREATE POLICY "Portal users can create tenant channels"
    ON chat_channels
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Authenticated users can update their tenant's channels
CREATE POLICY "Portal users can update tenant channels"
    ON chat_channels
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
    );

-- Customers can read their own channels
CREATE POLICY "Customers can read own channels"
    ON chat_channels
    FOR SELECT
    TO authenticated
    USING (
        customer_id IN (
            SELECT cu.customer_id FROM customer_users cu WHERE cu.auth_user_id = auth.uid()
        )
    );

-- ============================================================================
-- CHAT CHANNEL MESSAGES POLICIES
-- ============================================================================

-- Service role has full access
CREATE POLICY "Service role has full access to chat_messages"
    ON chat_channel_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Portal users can read messages from their tenant's channels
CREATE POLICY "Portal users can read tenant messages"
    ON chat_channel_messages
    FOR SELECT
    TO authenticated
    USING (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    );

-- Portal users can insert messages to their tenant's channels
CREATE POLICY "Portal users can send tenant messages"
    ON chat_channel_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    );

-- Portal users can update messages (mark as read)
CREATE POLICY "Portal users can update tenant messages"
    ON chat_channel_messages
    FOR UPDATE
    TO authenticated
    USING (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    );

-- Customers can read messages from their own channels
CREATE POLICY "Customers can read own messages"
    ON chat_channel_messages
    FOR SELECT
    TO authenticated
    USING (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.customer_id IN (
                SELECT cu.customer_id FROM customer_users cu WHERE cu.auth_user_id = auth.uid()
            )
        )
    );

-- Customers can send messages to their own channels
CREATE POLICY "Customers can send own messages"
    ON chat_channel_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.customer_id IN (
                SELECT cu.customer_id FROM customer_users cu WHERE cu.auth_user_id = auth.uid()
            )
        )
    );

-- Customers can update messages in their channels (mark as read)
CREATE POLICY "Customers can update own messages"
    ON chat_channel_messages
    FOR UPDATE
    TO authenticated
    USING (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.customer_id IN (
                SELECT cu.customer_id FROM customer_users cu WHERE cu.auth_user_id = auth.uid()
            )
        )
    );

-- ============================================================================
-- CHAT CHANNEL PARTICIPANTS POLICIES
-- ============================================================================

-- Service role has full access
CREATE POLICY "Service role has full access to chat_participants"
    ON chat_channel_participants
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Portal users can manage participants in their tenant's channels
CREATE POLICY "Portal users can manage tenant participants"
    ON chat_channel_participants
    FOR ALL
    TO authenticated
    USING (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
    );

-- Customers can manage their own participant record
CREATE POLICY "Customers can manage own participant record"
    ON chat_channel_participants
    FOR ALL
    TO authenticated
    USING (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.customer_id IN (
                SELECT cu.customer_id FROM customer_users cu WHERE cu.auth_user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.customer_id IN (
                SELECT cu.customer_id FROM customer_users cu WHERE cu.auth_user_id = auth.uid()
            )
        )
    );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE chat_channels IS 'Stores chat channels - one per tenant-customer pair for real-time messaging';
COMMENT ON TABLE chat_channel_messages IS 'Stores all messages within chat channels';
COMMENT ON TABLE chat_channel_participants IS 'Tracks participant-specific data like unread counts and mute settings';
