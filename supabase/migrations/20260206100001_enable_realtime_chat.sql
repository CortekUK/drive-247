-- Enable Realtime on chat tables for live message updates
-- This replaces the Socket.io chat server with Supabase Realtime

-- Add chat_channel_messages to Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE chat_channel_messages;

-- Add chat_channels to Realtime publication (for channel updates like last_message_at)
ALTER PUBLICATION supabase_realtime ADD TABLE chat_channels;
