-- Complete fix for Realtime on chat_messages
-- Run this in Supabase SQL Editor

-- Step 1: Verify and set REPLICA IDENTITY FULL
ALTER TABLE chat_messages REPLICA IDENTITY FULL;

-- Step 2: Ensure table is in Realtime publication
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

-- Step 3: Verify Realtime is enabled (this query should return 1 row)
SELECT 
    schemaname,
    tablename,
    pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' 
AND tablename = 'chat_messages';

-- Step 4: Check REPLICA IDENTITY (should return 'f' for FULL)
SELECT 
    relname,
    relreplident
FROM pg_class
WHERE relname = 'chat_messages';

-- Step 5: Ensure RLS policies allow Realtime subscriptions
-- Realtime needs SELECT permission for the anon role
-- The existing policy should work, but let's make sure it's correct

-- Verify current policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'chat_messages';

