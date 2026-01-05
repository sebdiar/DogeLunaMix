-- =====================================================
-- DOGEUB - CHANGE PARENT_ID TO JSONB ARRAY
-- Run this in Supabase SQL Editor
-- =====================================================

-- This migration changes parent_id from UUID to JSONB array
-- to support multiple parents per project (like Notion's multi-select relation)

DO $$ 
BEGIN
    -- Step 1: Add a temporary column to store the array
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'spaces' 
        AND column_name = 'parent_ids'
    ) THEN
        ALTER TABLE spaces 
        ADD COLUMN parent_ids JSONB DEFAULT '[]'::jsonb;
    END IF;
    
    -- Step 2: Migrate existing parent_id values to parent_ids array
    -- Convert single UUID to array format: [uuid]
    UPDATE spaces
    SET parent_ids = CASE 
        WHEN parent_id IS NOT NULL THEN jsonb_build_array(parent_id::text)
        ELSE '[]'::jsonb
    END
    WHERE parent_ids = '[]'::jsonb OR parent_ids IS NULL;
    
    -- Step 3: Drop the old parent_id column (we'll recreate it as JSONB)
    ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_parent_id_fkey;
    ALTER TABLE spaces DROP COLUMN IF EXISTS parent_id;
    
    -- Step 4: Rename parent_ids to parent_id (now as JSONB array)
    ALTER TABLE spaces RENAME COLUMN parent_ids TO parent_id;
    
    -- Step 5: Set default to empty array
    ALTER TABLE spaces ALTER COLUMN parent_id SET DEFAULT '[]'::jsonb;
    
    -- Step 6: Create GIN index for efficient array searches
    CREATE INDEX IF NOT EXISTS idx_spaces_parent_id ON spaces USING GIN (parent_id);
    
END $$;

-- =====================================================
-- DONE! Verify with:
-- SELECT id, name, parent_id FROM spaces WHERE parent_id != '[]'::jsonb LIMIT 5;
-- =====================================================

