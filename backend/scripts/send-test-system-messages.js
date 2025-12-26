/**
 * Script para enviar mensajes del sistema reales en chats
 * Esto crea mensajes en la base de datos y envía notificaciones push
 * Ejecuta: node backend/scripts/send-test-system-messages.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';
import { sendSystemMessageNotifications } from '../routes/chat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '../../.env') });

async function sendTestSystemMessages() {
  try {
    console.log('🧪 Sending test system messages to chats...\n');
    
    // Get all chats that have participants
    // First get chat IDs from participants
    const { data: participants, error: participantsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .limit(30);
    
    if (participantsError) {
      console.error('❌ Error fetching participants:', participantsError);
      process.exit(1);
    }
    
    if (!participants || participants.length === 0) {
      console.log('⚠️  No chats with participants found');
      console.log('💡 Create a chat first in the app');
      process.exit(1);
    }
    
    // Get unique chat IDs
    const uniqueChatIds = [...new Set(participants.map(p => p.chat_id))];
    console.log(`📱 Found ${uniqueChatIds.length} chat(s) with participants\n`);
    
    // Get chat details with space info
    const { data: spaceChats } = await supabase
      .from('space_chats')
      .select('chat_id, space_id, spaces!inner(name, category)')
      .in('chat_id', uniqueChatIds);
    
    let messagesSent = 0;
    let notificationsSent = 0;
    
    // Send test messages to first few chats
    const chatsToUse = uniqueChatIds.slice(0, Math.min(3, uniqueChatIds.length));
    
    for (const chatId of chatsToUse) {
      try {
        const spaceChat = spaceChats?.find(sc => sc.chat_id === chatId);
        const spaceName = spaceChat?.spaces?.name || 'Chat';
        const spaceCategory = spaceChat?.spaces?.category || 'unknown';
        
        console.log(`📤 Sending test message to chat: ${spaceName} (${spaceCategory})`);
        
        // Create test system message
        const testMessage = `🧪 Test system message - ${new Date().toLocaleString()}\n\nThis is a test message from the system to verify notifications and unread badges.`;
        
        // Insert system message
        const { data: newMessage, error: insertError } = await supabase
          .from('chat_messages')
          .insert({
            chat_id: chatId,
            user_id: null, // null = system message
            message: testMessage
          })
          .select('id, chat_id, message, created_at')
          .single();
        
        if (insertError) {
          console.error(`   ❌ Error inserting message: ${insertError.message}`);
          continue;
        }
        
        messagesSent++;
        console.log(`   ✅ Message inserted: ${newMessage.id}`);
        
        // Send push notifications (in background)
        try {
          await sendSystemMessageNotifications(chatId, testMessage);
          notificationsSent++;
          console.log(`   ✅ Notifications sent`);
        } catch (notifError) {
          console.error(`   ⚠️  Error sending notifications: ${notifError.message}`);
        }
        
        console.log('');
        
      } catch (error) {
        console.error(`   ❌ Error processing chat ${chatId}:`, error.message);
      }
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`✅ Messages sent: ${messagesSent}`);
    console.log(`📱 Notifications sent: ${notificationsSent}`);
    console.log(`💬 Chats updated: ${chatsToUse.length}`);
    
    if (messagesSent > 0) {
      console.log('\n✅ Test system messages sent successfully!');
      console.log('💡 Check your app:');
      console.log('   - Messages should appear in the chats');
      console.log('   - Red badge should show unread count in sidebar');
      console.log('   - Push notifications should arrive');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run
sendTestSystemMessages();

