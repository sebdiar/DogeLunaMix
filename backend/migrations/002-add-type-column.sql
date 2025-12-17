-- =====================================================
-- DOGEUB - ADD TYPE COLUMN TO TABS TABLE
-- Run this in Supabase SQL Editor if the 'type' column doesn't exist
-- =====================================================

-- Add 'type' column to tabs table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tabs' 
        AND column_name = 'type'
    ) THEN
        ALTER TABLE tabs 
        ADD COLUMN type TEXT DEFAULT 'browser';
        
        -- Update existing rows to have 'browser' type
        UPDATE tabs 
        SET type = 'browser' 
        WHERE type IS NULL;
    END IF;
END $$;

-- Add 'metadata' column to tabs table if it doesn't exist (for future use)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tabs' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE tabs 
        ADD COLUMN metadata JSONB;
    END IF;
END $$;

















