/**
 * Script para enviar mensajes del sistema a proyectos específicos
 * Ejecuta: node backend/scripts/send-test-to-specific-projects.js
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

async function sendTestToSpecificProjects() {
  try {
    console.log('🧪 Sending test system messages to specific projects...\n');
    
    // Search for projects containing these keywords
    const keywords = ['Amazon', 'TikTok'];
    
    // Find projects by name (case-insensitive search)
    const { data: allProjects, error: allProjectsError } = await supabase
      .from('spaces')
      .select('id, name, category')
      .eq('category', 'project');
    
    if (allProjectsError) {
      console.error('❌ Error fetching projects:', allProjectsError);
      process.exit(1);
    }
    
    if (allProjectsError) {
      console.error('❌ Error fetching projects:', allProjectsError);
      process.exit(1);
    }
    
    // Filter projects that contain the keywords
    const projects = allProjects?.filter(p => 
      keywords.some(keyword => 
        p.name.toLowerCase().includes(keyword.toLowerCase())
      )
    ) || [];
    
    if (!projects || projects.length === 0) {
      console.log('⚠️  No projects found with those names');
      console.log('💡 Available projects:');
      const { data: allProjects } = await supabase
        .from('spaces')
        .select('name, category')
        .eq('category', 'project')
        .limit(10);
      allProjects?.forEach(p => console.log(`   - ${p.name}`));
      process.exit(1);
    }
    
    console.log(`📱 Found ${projects.length} project(s):\n`);
    projects.forEach(p => console.log(`   - ${p.name} (${p.id})`));
    console.log('');
    
    let messagesSent = 0;
    let notificationsSent = 0;
    
    // Send one message to each project
    for (const project of projects) {
      try {
        console.log(`📤 Sending test message to: ${project.name}`);
        
        // Get chat for this project
        const { data: spaceChat, error: spaceChatError } = await supabase
          .from('space_chats')
          .select('chat_id')
          .eq('space_id', project.id)
          .single();
        
        if (spaceChatError || !spaceChat) {
          console.log(`   ⚠️  No chat found for project, creating one...`);
          
          // Get project owner
          const { data: projectData } = await supabase
            .from('spaces')
            .select('user_id')
            .eq('id', project.id)
            .single();
          
          if (!projectData) {
            console.log(`   ❌ Could not find project owner`);
            continue;
          }
          
          // Import getOrCreateChatForSpace
          const { getOrCreateChatForSpace } = await import('../routes/chat.js');
          const chatId = await getOrCreateChatForSpace(project.id, projectData.user_id);
          
          if (!chatId) {
            console.log(`   ❌ Could not create chat`);
            continue;
          }
          
          spaceChat = { chat_id: chatId };
        }
        
        const chatId = spaceChat.chat_id;
        
        // Create test system message
        const testMessage = `🧪 Test system message - ${new Date().toLocaleString()}\n\nEste es un mensaje de prueba del sistema para verificar notificaciones y badges de mensajes sin leer.`;
        
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
        
        // Send push notifications
        try {
          await sendSystemMessageNotifications(chatId, testMessage);
          notificationsSent++;
          console.log(`   ✅ Notifications sent`);
        } catch (notifError) {
          console.error(`   ⚠️  Error sending notifications: ${notifError.message}`);
        }
        
        console.log('');
        
      } catch (error) {
        console.error(`   ❌ Error processing project ${project.name}:`, error.message);
      }
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`✅ Messages sent: ${messagesSent}`);
    console.log(`📱 Notifications sent: ${notificationsSent}`);
    console.log(`💬 Projects updated: ${projects.length}`);
    
    if (messagesSent > 0) {
      console.log('\n✅ Test system messages sent successfully!');
      console.log('💡 Check your app:');
      console.log('   - Messages should appear in the project chats');
      console.log('   - Red badge should show unread count in sidebar');
      console.log('   - Push notifications should arrive');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run
sendTestToSpecificProjects();

