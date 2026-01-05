-- =====================================================
-- DOGEUB - ADD TAG PARENTS COLUMN TO SPACES
-- Run this in Supabase SQL Editor
-- =====================================================

-- Add tag_parents column to spaces table
-- This stores parent_id relationships per tag: { "tagName": "parentId", ... }
DO $$ 
BEGIN
    -- Add tag_parents column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'spaces' 
        AND column_name = 'tag_parents'
    ) THEN
        ALTER TABLE spaces 
        ADD COLUMN tag_parents JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Create GIN index for efficient tag_parents searches
CREATE INDEX IF NOT EXISTS idx_spaces_tag_parents ON spaces USING GIN (tag_parents);

-- =====================================================
-- DONE! Verify with:
-- SELECT id, name, tags, tag_parents FROM spaces WHERE tag_parents IS NOT NULL AND tag_parents != '{}'::jsonb LIMIT 5;
-- =====================================================

