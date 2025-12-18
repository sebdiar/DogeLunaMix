-- =====================================================
-- Create chat_message_reads table to track read/unread messages
-- =====================================================

-- Create table to track which messages each user has read
CREATE TABLE IF NOT EXISTS chat_message_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
  last_read_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(chat_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_chat_id ON chat_message_reads(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user_id ON chat_message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_last_read_message_id ON chat_message_reads(last_read_message_id);

-- Enable Realtime for chat_message_reads table
ALTER TABLE chat_message_reads REPLICA IDENTITY FULL;

-- Add to Realtime publication only if not already added
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'chat_message_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_message_reads;
  END IF;
END $$;

