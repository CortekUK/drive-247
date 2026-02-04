-- Cleanup migration: Remove chat functions and triggers
-- These are being replaced with direct queries in the application code

-- Drop triggers first (must be dropped before their functions)
DROP TRIGGER IF EXISTS chat_channel_updated_at ON chat_channels;
DROP TRIGGER IF EXISTS chat_message_update_channel ON chat_channel_messages;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_chat_channel_updated_at();
DROP FUNCTION IF EXISTS update_channel_last_message();

-- Drop helper functions
DROP FUNCTION IF EXISTS get_or_create_chat_channel(UUID, UUID);
DROP FUNCTION IF EXISTS get_chat_unread_count(TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS mark_chat_messages_read(UUID, TEXT);
