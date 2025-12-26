-- Migration: Auto-notify on chat message insert
-- Purpose: Automatically send push notifications when any message is inserted into chat_messages
-- This works for both user messages and system messages (user_id = null)

-- First, enable pg_net extension if available (Supabase has this by default)
-- If pg_net is not available, this migration will still work but notifications won't be sent from trigger
-- The backend will handle notifications as fallback

-- Function to send notification via HTTP to backend
CREATE OR REPLACE FUNCTION notify_chat_message_inserted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  backend_url TEXT;
  notification_payload JSONB;
BEGIN
  -- Get backend URL from environment or use default
  -- In Supabase, set this via: ALTER DATABASE postgres SET app.backend_url = 'https://your-backend.com';
  -- Or set it per session: SET app.backend_url = 'https://your-backend.com';
  -- The URL should be your backend API URL (e.g., https://teneriadiaz.replit.app)
  SELECT COALESCE(
    current_setting('app.backend_url', true),
    current_setting('app.settings.backend_url', true),
    'http://localhost:3001'  -- Default fallback (change this to your production URL)
  ) INTO backend_url;

  -- Build notification payload
  notification_payload := jsonb_build_object(
    'chat_id', NEW.chat_id,
    'message_id', NEW.id,
    'user_id', NEW.user_id,
    'message', NEW.message,
    'created_at', NEW.created_at
  );

  -- Try to send HTTP request using pg_net (if available)
  -- This will fail silently if pg_net is not available
  BEGIN
    PERFORM net.http_post(
      url := backend_url || '/api/chat/internal/notify-message',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Request', 'true'
      ),
      body := notification_payload::text
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- If pg_net is not available or request fails, log but don't raise error
      -- The backend will handle notifications as fallback
      RAISE WARNING 'Could not send notification via trigger: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Create trigger that fires after INSERT on chat_messages
CREATE TRIGGER trigger_notify_chat_message_inserted
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_chat_message_inserted();

-- Add comment
COMMENT ON FUNCTION notify_chat_message_inserted() IS 'Automatically sends push notification when a chat message is inserted';
COMMENT ON TRIGGER trigger_notify_chat_message_inserted ON chat_messages IS 'Triggers notification for all chat message inserts (user and system messages)';

