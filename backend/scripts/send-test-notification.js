/**
 * Script para enviar notificaciones push de prueba directamente
 * Ejecuta: node backend/scripts/send-test-notification.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import webpush from 'web-push';
import supabase from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '../../.env') });

// VAPID configuration
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidMailto = process.env.VAPID_MAILTO || 'mailto:support@dogeluna.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidMailto, vapidPublicKey, vapidPrivateKey);
  console.log('✅ VAPID keys configured');
} else {
  console.error('❌ VAPID keys not configured!');
  console.log('💡 Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
  process.exit(1);
}

async function sendTestNotification() {
  try {
    console.log('🧪 Sending test system notification...\n');
    
    // Get all users with push subscriptions
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*, user_id');
    
    if (error) {
      console.error('❌ Error fetching subscriptions:', error);
      process.exit(1);
    }
    
    if (!subscriptions || subscriptions.length === 0) {
      console.log('⚠️  No push subscriptions found');
      console.log('💡 Make sure users have subscribed to push notifications in the app');
      process.exit(1);
    }
    
    console.log(`📱 Found ${subscriptions.length} subscription(s)\n`);
    
    // Prepare test notification
    const testTitle = 'System';
    const testBody = `🧪 Test system notification - ${new Date().toLocaleString()}`;
    
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
    
    // Send to all subscriptions
    console.log('📤 Sending notifications...\n');
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          return { 
            success: true, 
            userId: sub.user_id,
            subscriptionId: sub.id 
          };
        } catch (error) {
          // If subscription is invalid (410 Gone), remove it
          if (error.statusCode === 410) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
            console.log(`🗑️  Removed invalid subscription for user ${sub.user_id}`);
          }
          
          return { 
            success: false, 
            userId: sub.user_id,
            error: error.message 
          };
        }
      })
    );
    
    // Print results
    const successful = results.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;
    const failed = results.length - successful;
    
    console.log('\n📊 Results:');
    console.log(`✅ Sent: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📱 Total: ${results.length}`);
    
    if (successful > 0) {
      console.log('\n✅ Test notification sent successfully!');
      console.log('💡 Check your device/browser for the notification');
    }
    
    if (failed > 0) {
      console.log('\n⚠️  Some notifications failed to send');
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && !result.value.success) {
          console.log(`   User ${result.value.userId}: ${result.value.error}`);
        } else if (result.status === 'rejected') {
          console.log(`   Subscription ${index}: ${result.reason}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run
sendTestNotification();

