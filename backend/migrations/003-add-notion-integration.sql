-- =====================================================
-- DOGEUB - ADD NOTION INTEGRATION
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. Add Notion fields to spaces table
DO $$ 
BEGIN
    -- Add notion_page_id if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'spaces' 
        AND column_name = 'notion_page_id'
    ) THEN
        ALTER TABLE spaces 
        ADD COLUMN notion_page_id VARCHAR(255);
    END IF;
    
    -- Add notion_page_url if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'spaces' 
        AND column_name = 'notion_page_url'
    ) THEN
        ALTER TABLE spaces 
        ADD COLUMN notion_page_url TEXT;
    END IF;
    
    -- Add archived if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'spaces' 
        AND column_name = 'archived'
    ) THEN
        ALTER TABLE spaces 
        ADD COLUMN archived BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 2. Create notion_config table
CREATE TABLE IF NOT EXISTS notion_config (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key TEXT,
  database_id VARCHAR(255),
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Create index for archived spaces
CREATE INDEX IF NOT EXISTS idx_spaces_archived ON spaces(archived);
CREATE INDEX IF NOT EXISTS idx_spaces_user_archived ON spaces(user_id, archived);

-- 4. Enable RLS for notion_config
ALTER TABLE notion_config ENABLE ROW LEVEL SECURITY;

-- 5. Create permissive policy for notion_config (auth handled by backend)
DROP POLICY IF EXISTS "Allow all on notion_config" ON notion_config;
CREATE POLICY "Allow all on notion_config" ON notion_config FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- DONE! Verify with:
-- SELECT * FROM notion_config LIMIT 5;
-- SELECT notion_page_id, notion_page_url, archived FROM spaces LIMIT 5;
-- =====================================================

