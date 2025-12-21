-- Allow NULL user_id in chat_messages for system messages
-- System messages (like "X added Y to project") should have user_id = NULL

ALTER TABLE chat_messages 
  ALTER COLUMN user_id DROP NOT NULL;

-- Update foreign key constraint to allow NULL
-- First, drop the existing foreign key constraint
ALTER TABLE chat_messages 
  DROP CONSTRAINT IF EXISTS chat_messages_user_id_fkey;

-- Recreate with ON DELETE SET NULL to handle user deletions gracefully
ALTER TABLE chat_messages 
  ADD CONSTRAINT chat_messages_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES users(id) 
  ON DELETE SET NULL;


