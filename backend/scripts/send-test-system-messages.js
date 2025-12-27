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
    
    // Get the current user ID from environment or use a default
    // For now, we'll get all spaces and their chats
    const { data: allSpaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, name, category, user_id')
      .limit(50);
    
    if (spacesError) {
      console.error('❌ Error fetching spaces:', spacesError);
      process.exit(1);
    }
    
    if (!allSpaces || allSpaces.length === 0) {
      console.log('⚠️  No spaces found');
      process.exit(1);
    }
    
    console.log(`📁 Found ${allSpaces.length} space(s)\n`);
    
    // Get all space_chats for these spaces
    const spaceIds = allSpaces.map(s => s.id);
    const { data: spaceChats, error: spaceChatsError } = await supabase
      .from('space_chats')
      .select('chat_id, space_id, spaces!inner(id, name, category, user_id)')
      .in('space_id', spaceIds);
    
    if (spaceChatsError) {
      console.error('❌ Error fetching space_chats:', spaceChatsError);
      process.exit(1);
    }
    
    if (!spaceChats || spaceChats.length === 0) {
      console.log('⚠️  No chats found for any spaces');
      console.log('💡 Create a chat first in the app');
      process.exit(1);
    }
    
    // Get unique chat IDs that are associated with spaces
    const uniqueChatIds = [...new Set(spaceChats.map(sc => sc.chat_id))];
    console.log(`📱 Found ${uniqueChatIds.length} chat(s) associated with spaces\n`);
    
    // Show which spaces have chats
    const spacesWithChats = {};
    spaceChats.forEach(sc => {
      const space = sc.spaces;
      if (!spacesWithChats[space.id]) {
        spacesWithChats[space.id] = {
          name: space.name,
          category: space.category,
          user_id: space.user_id,
          chatIds: []
        };
      }
      spacesWithChats[space.id].chatIds.push(sc.chat_id);
    });
    
    console.log('📋 Spaces with chats:');
    Object.entries(spacesWithChats).slice(0, 10).forEach(([spaceId, info]) => {
      console.log(`   - ${info.name} (${info.category}) - ${info.chatIds.length} chat(s)`);
    });
    console.log('');
    
    let messagesSent = 0;
    let notificationsSent = 0;
    
    // Send test messages to first few chats that are associated with spaces
    const chatsToUse = uniqueChatIds.slice(0, Math.min(5, uniqueChatIds.length));
    
    for (const chatId of chatsToUse) {
      try {
        const spaceChatsForThisChat = spaceChats?.filter(sc => sc.chat_id === chatId);
        
        if (!spaceChatsForThisChat || spaceChatsForThisChat.length === 0) {
          console.log(`⚠️  Chat ${chatId} is not associated with any space, skipping...`);
          continue;
        }
        
        // Get the first space (should only be one, but handle multiple)
        const spaceChat = spaceChatsForThisChat[0];
        const spaceName = spaceChat?.spaces?.name || 'Unknown';
        const spaceCategory = spaceChat?.spaces?.category || 'unknown';
        const spaceId = spaceChat?.space_id;
        const userId = spaceChat?.spaces?.user_id;
        
        if (spaceChatsForThisChat.length > 1) {
          console.log(`⚠️  WARNING: Chat ${chatId} is associated with ${spaceChatsForThisChat.length} spaces!`);
        }
        
        console.log(`📤 Sending test message to:`);
        console.log(`   Chat ID: ${chatId}`);
        console.log(`   Space: ${spaceName} (${spaceCategory})`);
        console.log(`   Space ID: ${spaceId}`);
        console.log(`   Owner: ${userId}`);
        
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

