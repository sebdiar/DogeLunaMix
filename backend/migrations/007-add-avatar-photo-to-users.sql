-- =====================================================
-- Add avatar_photo column to users table if it doesn't exist
-- =====================================================

-- Add avatar_photo column to users table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'avatar_photo'
    ) THEN
        ALTER TABLE users ADD COLUMN avatar_photo TEXT;
        RAISE NOTICE 'Column avatar_photo added to users table';
    ELSE
        RAISE NOTICE 'Column avatar_photo already exists in users table';
    END IF;
END $$;




