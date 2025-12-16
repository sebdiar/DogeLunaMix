-- Enable Realtime for chat_messages table
-- Run this in Supabase SQL Editor

-- Step 1: Set REPLICA IDENTITY to FULL (required for Realtime to work properly)
-- This ensures all changes (INSERT, UPDATE, DELETE) are replicated
ALTER TABLE chat_messages REPLICA IDENTITY FULL;

-- Step 2: Add table to Realtime publication (if not already added)
-- This command will fail if already added, which is fine
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'chat_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    END IF;
END $$;



