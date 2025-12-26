import express from 'express';
import webpush from 'web-push';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// VAPID configuration
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidMailto = process.env.VAPID_MAILTO || 'mailto:support@dogeluna.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    vapidMailto,
    vapidPublicKey,
    vapidPrivateKey
  );
  console.log('✅ VAPID keys configured for push notifications');
} else {
  console.warn('⚠️  VAPID keys not configured - push notifications will not work');
}

// Get VAPID public key (for client subscription)
router.get('/vapid-public-key', (req, res) => {
  if (!vapidPublicKey) {
    return res.status(500).json({ error: 'VAPID public key not configured' });
  }
  res.json({ publicKey: vapidPublicKey });
});

// Subscribe to push notifications
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const subscription = req.body;
    const userId = req.userId;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    // Store subscription in database
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        subscription: subscription,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,subscription_endpoint',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Error storing push subscription:', error);
      return res.status(500).json({ error: 'Failed to store subscription' });
    }

    res.status(201).json({ success: true, message: 'Subscribed to push notifications' });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    const userId = req.userId;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint required' });
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('subscription_endpoint', endpoint);

    if (error) {
      console.error('Error removing subscription:', error);
      return res.status(500).json({ error: 'Failed to unsubscribe' });
    }

    res.json({ success: true, message: 'Unsubscribed from push notifications' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send push notification to specific user(s)
router.post('/send', authenticate, async (req, res) => {
  try {
    const { userIds, title, body, data } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array required' });
    }

    // Get all subscriptions for these users
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds);

    if (error) {
      console.error('Error fetching subscriptions:', error);
      return res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No active subscriptions for these users' });
    }

    // Prepare notification payload
    const payload = JSON.stringify({
      title: title || 'DogeLunaMix',
      body: body || 'You have a new notification',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: data || {}
    });

    // Send notifications to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          return { success: true, userId: sub.user_id };
        } catch (error) {
          console.error(`Failed to send push to user ${sub.user_id}:`, error);
          
          // If subscription is invalid (410 Gone), remove it
          if (error.statusCode === 410) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
          }
          
          return { success: false, userId: sub.user_id, error: error.message };
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - sent;

    res.json({ 
      success: true, 
      sent, 
      failed,
      total: results.length 
    });
  } catch (error) {
    console.error('Send push notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test endpoint: Send a test system message notification to current user
router.post('/test/system', authenticate, async (req, res) => {
  try {
    const { title, body } = req.body;
    
    const testTitle = title || 'System';
    const testBody = body || `🧪 Test system notification - ${new Date().toLocaleString()}`;
    
    // Send push notification to current user
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', req.userId);
    
    if (error) {
      console.error('Error fetching subscriptions:', error);
      return res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
    
    if (!subscriptions || subscriptions.length === 0) {
      return res.status(400).json({ 
        error: 'No active push subscriptions found for your account',
        hint: 'Make sure you have granted notification permissions and subscribed to push notifications'
      });
    }
    
    // Prepare notification payload
    const payload = JSON.stringify({
      title: testTitle,
      body: testBody,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: {
        type: 'test_system_message',
        timestamp: new Date().toISOString()
      }
    });
    
    // Send notifications to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          return { success: true, subscriptionId: sub.id };
        } catch (error) {
          console.error(`Failed to send test push to subscription ${sub.id}:`, error);
          
          // If subscription is invalid (410 Gone), remove it
          if (error.statusCode === 410) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
          }
          
          return { success: false, subscriptionId: sub.id, error: error.message };
        }
      })
    );
    
    const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - sent;
    
    res.json({ 
      success: true, 
      message: 'Test system notification sent',
      sent, 
      failed,
      total: results.length,
      title: testTitle,
      body: testBody
    });
  } catch (error) {
    console.error('Test system notification error:', error);
    res.status(500).json({ error: 'Failed to send test system notification' });
  }
});

export default router;


