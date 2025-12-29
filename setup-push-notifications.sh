#!/bin/bash

# Script to test push notifications setup

echo "🔧 Setting up Push Notifications..."
echo ""

# Check if .env exists
if [ ! -f "dogeub/.env" ]; then
    echo "❌ Error: dogeub/.env file not found"
    echo "Please create a .env file in dogeub/ directory with your Supabase credentials"
    exit 1
fi

# Check if VAPID keys are in .env
if ! grep -q "VAPID_PUBLIC_KEY" dogeub/.env; then
    echo "⚠️  VAPID keys not found in .env"
    echo ""
    echo "Please add these lines to your dogeub/.env file:"
    echo ""
    cat dogeub/backend/VAPID_KEYS.txt
    echo ""
    echo "After adding the keys, run this script again."
    exit 1
fi

echo "✅ VAPID keys found in .env"
echo ""

# Run the migration
echo "📝 Running migration to create push_subscriptions table..."
echo ""

# Check if Supabase URL and key are set
if grep -q "SUPABASE_URL=your_supabase_url" dogeub/.env; then
    echo "❌ Error: Please update SUPABASE_URL in dogeub/.env"
    exit 1
fi

echo "To run the migration, you need to:"
echo "1. Go to your Supabase dashboard"
echo "2. Open SQL Editor"
echo "3. Run the SQL from: dogeub/backend/migrations/011-create-push-subscriptions.sql"
echo ""
echo "After running the migration, your push notifications will be ready!"
echo ""
echo "📋 Next steps:"
echo "  1. Ensure backend server is running: cd dogeub/backend && npm start"
echo "  2. Open the app in your browser"
echo "  3. Accept notification permissions when prompted"
echo "  4. Send a test message to see push notifications"
echo ""



