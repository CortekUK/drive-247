-- Fix chat tables RLS to include super admin access
-- Super admins should be able to access any tenant's chat data

-- ============================================================================
-- DROP EXISTING POLICIES
-- ============================================================================

-- Chat channels
DROP POLICY IF EXISTS "Portal users can read tenant channels" ON chat_channels;
DROP POLICY IF EXISTS "Portal users can create tenant channels" ON chat_channels;
DROP POLICY IF EXISTS "Portal users can update tenant channels" ON chat_channels;

-- Chat messages
DROP POLICY IF EXISTS "Portal users can read tenant messages" ON chat_channel_messages;
DROP POLICY IF EXISTS "Portal users can send tenant messages" ON chat_channel_messages;
DROP POLICY IF EXISTS "Portal users can update tenant messages" ON chat_channel_messages;

-- Chat participants
DROP POLICY IF EXISTS "Portal users can manage tenant participants" ON chat_channel_participants;

-- ============================================================================
-- RECREATE POLICIES WITH SUPER ADMIN ACCESS
-- ============================================================================

-- CHAT CHANNELS - Portal/Super Admin policies
CREATE POLICY "Portal users can read tenant channels"
    ON chat_channels
    FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
        OR is_super_admin()
    );

CREATE POLICY "Portal users can create tenant channels"
    ON chat_channels
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
        OR is_super_admin()
    );

CREATE POLICY "Portal users can update tenant channels"
    ON chat_channels
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
        OR is_super_admin()
    )
    WITH CHECK (
        tenant_id IN (
            SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
        )
        OR is_super_admin()
    );

-- CHAT MESSAGES - Portal/Super Admin policies
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
        OR is_super_admin()
    );

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
        OR is_super_admin()
    );

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
        OR is_super_admin()
    );

-- CHAT PARTICIPANTS - Portal/Super Admin policies
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
        OR is_super_admin()
    )
    WITH CHECK (
        channel_id IN (
            SELECT cc.id FROM chat_channels cc
            WHERE cc.tenant_id IN (
                SELECT au.tenant_id FROM app_users au WHERE au.auth_user_id = auth.uid()
            )
        )
        OR is_super_admin()
    );
