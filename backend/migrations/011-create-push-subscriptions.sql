-- Migration: Create push_subscriptions table
-- Purpose: Store web push notification subscriptions for users

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  subscription_endpoint TEXT GENERATED ALWAYS AS (subscription->>'endpoint') STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one subscription per user per endpoint
  UNIQUE(user_id, subscription_endpoint)
);

-- Index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Index for faster lookups by endpoint (for cleanup)
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(subscription_endpoint);

-- Enable Row Level Security
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see and manage their own subscriptions
CREATE POLICY "Users can manage own push subscriptions"
  ON push_subscriptions
  FOR ALL
  USING (auth.uid() = user_id);

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO service_role;

-- Function to clean up old/expired subscriptions (optional)
CREATE OR REPLACE FUNCTION cleanup_old_push_subscriptions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Delete subscriptions older than 90 days that haven't been updated
  DELETE FROM push_subscriptions
  WHERE updated_at < NOW() - INTERVAL '90 days';
END;
$$;

-- Add comment
COMMENT ON TABLE push_subscriptions IS 'Stores web push notification subscriptions for users';


