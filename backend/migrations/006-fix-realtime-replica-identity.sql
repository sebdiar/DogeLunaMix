-- =====================================================
-- FIX REALTIME FOR chat_messages TABLE
-- Run this in Supabase SQL Editor
-- =====================================================
-- This migration fixes Realtime configuration for chat_messages
-- Realtime requires REPLICA IDENTITY FULL to work properly

-- Step 1: Set REPLICA IDENTITY to FULL (REQUIRED for Realtime to work)
-- This ensures all changes (INSERT, UPDATE, DELETE) are replicated via Realtime
ALTER TABLE chat_messages REPLICA IDENTITY FULL;

-- Step 2: Ensure table is in supabase_realtime publication
-- This command will not fail if already added
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'chat_messages'
        AND schemaname = 'public'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    END IF;
END $$;

-- Step 3: Verify configuration (run this to check if everything is correct)
-- Expected result: replica_identity should be 'FULL ✅' and in_publication should be true
SELECT 
  t.tablename,
  CASE 
    WHEN c.relreplident = 'd' THEN 'DEFAULT'
    WHEN c.relreplident = 'f' THEN 'FULL ✅'
    WHEN c.relreplident = 'n' THEN 'NOTHING'
    WHEN c.relreplident = 'i' THEN 'INDEX'
  END as replica_identity,
  EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'chat_messages'
    AND schemaname = 'public'
  ) as in_publication
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE t.schemaname = 'public' 
  AND t.tablename = 'chat_messages';

