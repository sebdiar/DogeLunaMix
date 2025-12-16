-- =====================================================
-- DOGEUB - INITIAL DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(255),
  avatar_photo TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Create spaces table
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'project',
  parent_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  is_expanded BOOLEAN DEFAULT true,
  avatar_emoji TEXT,
  avatar_color TEXT,
  avatar_photo TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT spaces_category_check CHECK (category IN ('project', 'user'))
);

-- 3. Create tabs table
CREATE TABLE IF NOT EXISTS tabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  bookmark_url TEXT,
  favicon TEXT,
  cookie_container_id VARCHAR(100) DEFAULT 'default',
  parent_id UUID REFERENCES tabs(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  is_expanded BOOLEAN DEFAULT true,
  avatar_emoji TEXT,
  avatar_color TEXT,
  avatar_photo TEXT,
  type TEXT DEFAULT 'browser',
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 4. Create chats table
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 5. Create space_chats table (link spaces to chats)
CREATE TABLE IF NOT EXISTS space_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(space_id, chat_id)
);

-- 6. Create chat_participants table
CREATE TABLE IF NOT EXISTS chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(chat_id, user_id)
);

-- 7. Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 8. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_spaces_user_id ON spaces(user_id);
CREATE INDEX IF NOT EXISTS idx_spaces_category ON spaces(category);
CREATE INDEX IF NOT EXISTS idx_spaces_parent_id ON spaces(parent_id);
CREATE INDEX IF NOT EXISTS idx_tabs_user_id ON tabs(user_id);
CREATE INDEX IF NOT EXISTS idx_tabs_space_id ON tabs(space_id);
CREATE INDEX IF NOT EXISTS idx_tabs_parent_id ON tabs(parent_id);
CREATE INDEX IF NOT EXISTS idx_space_chats_space_id ON space_chats(space_id);
CREATE INDEX IF NOT EXISTS idx_space_chats_chat_id ON space_chats(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_chat_id ON chat_participants(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- 9. Set default name from email where null
UPDATE users SET name = split_part(email, '@', 1) WHERE name IS NULL OR name = '';

-- 10. Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 11. Create permissive policies (auth handled by backend)
DROP POLICY IF EXISTS "Allow all on users" ON users;
CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on spaces" ON spaces;
CREATE POLICY "Allow all on spaces" ON spaces FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on tabs" ON tabs;
CREATE POLICY "Allow all on tabs" ON tabs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on chats" ON chats;
CREATE POLICY "Allow all on chats" ON chats FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on space_chats" ON space_chats;
CREATE POLICY "Allow all on space_chats" ON space_chats FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on chat_participants" ON chat_participants;
CREATE POLICY "Allow all on chat_participants" ON chat_participants FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on chat_messages" ON chat_messages;
CREATE POLICY "Allow all on chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- DONE! Verify with:
-- SELECT * FROM users LIMIT 5;
-- SELECT * FROM spaces LIMIT 5;
-- SELECT * FROM tabs LIMIT 5;
-- =====================================================














