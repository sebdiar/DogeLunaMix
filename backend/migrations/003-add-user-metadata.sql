-- Add metadata column to users table for storing user preferences
-- This will store tab preferences like desktop_more_tab_ids and mobile_more_tab_ids

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE users ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Create index on metadata for faster queries
CREATE INDEX IF NOT EXISTS idx_users_metadata ON users USING GIN (metadata);


















