-- =====================================================
-- DOGEUB - ADD TAGS COLUMN TO SPACES
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add tags column to spaces table
DO $$ 
BEGIN
    -- Add tags column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'spaces' 
        AND column_name = 'tags'
    ) THEN
        ALTER TABLE spaces 
        ADD COLUMN tags JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- Create GIN index for efficient tag searches
CREATE INDEX IF NOT EXISTS idx_spaces_tags ON spaces USING GIN (tags);

-- =====================================================
-- DONE! Verify with:
-- SELECT id, name, tags FROM spaces WHERE tags IS NOT NULL AND tags != '[]'::jsonb LIMIT 5;
-- =====================================================


