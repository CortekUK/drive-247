-- Add presence tracking for chat users
-- Tracks online status and last seen time

-- Add last_seen_at to chat_channel_participants
ALTER TABLE chat_channel_participants
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;

-- Create index for online status queries
CREATE INDEX IF NOT EXISTS idx_chat_participants_online
ON chat_channel_participants(channel_id, is_online)
WHERE is_online = true;

-- Create index for last seen queries
CREATE INDEX IF NOT EXISTS idx_chat_participants_last_seen
ON chat_channel_participants(channel_id, last_seen_at DESC NULLS LAST);