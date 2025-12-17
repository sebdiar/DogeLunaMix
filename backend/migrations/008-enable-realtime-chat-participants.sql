-- Enable Realtime for chat_participants table
-- This allows the frontend to listen for changes when users are added/removed from projects

-- Step 1: Set REPLICA IDENTITY to FULL (REQUIRED for Realtime DELETE events to work)
ALTER TABLE chat_participants REPLICA IDENTITY FULL;

-- Step 2: Add table to Realtime publication (if not already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'chat_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_participants;
  END IF;
END $$;

-- Step 3: Verify configuration
SELECT 
  tablename,
  schemaname,
  (SELECT relreplident::text FROM pg_class WHERE relname = 'chat_participants') as replica_identity,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'chat_participants'
    ) THEN 'true' 
    ELSE 'false' 
  END as in_publication
FROM pg_tables 
WHERE tablename = 'chat_participants';

-- Expected result: replica_identity should be 'f' (FULL) and in_publication should be true

