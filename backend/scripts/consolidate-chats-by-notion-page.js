/**
 * Script to consolidate chats for projects with the same notion_page_id
 * 
 * This script:
 * 1. Finds all projects with notion_page_id
 * 2. Groups them by notion_page_id
 * 3. For each group, merges all chats into one shared chat
 * 4. Links all spaces to the shared chat
 * 5. Adds all users as participants
 * 
 * Usage: node scripts/consolidate-chats-by-notion-page.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function consolidateChats() {
  console.log('🔍 Finding projects with notion_page_id...\n');
  
  // Find all projects with notion_page_id
  const { data: allProjects, error: fetchError } = await supabase
    .from('spaces')
    .select('id, notion_page_id, user_id, name')
    .eq('category', 'project')
    .not('notion_page_id', 'is', null);
  
  if (fetchError) {
    console.error('❌ Error fetching projects:', fetchError);
    process.exit(1);
  }
  
  if (!allProjects || allProjects.length === 0) {
    console.log('✅ No projects with notion_page_id found.');
    return;
  }
  
  // Group by notion_page_id
  const projectsByNotionId = new Map();
  allProjects.forEach(project => {
    if (!projectsByNotionId.has(project.notion_page_id)) {
      projectsByNotionId.set(project.notion_page_id, []);
    }
    projectsByNotionId.get(project.notion_page_id).push(project);
  });
  
  console.log(`📦 Found ${projectsByNotionId.size} unique Notion projects\n`);
  
  for (const [notionPageId, projects] of projectsByNotionId.entries()) {
    if (projects.length === 0) continue;
    
    console.log(`\n📄 Processing Notion Page ID: ${notionPageId}`);
    console.log(`   Project: "${projects[0].name}"`);
    console.log(`   Spaces: ${projects.length}`);
    
    // Get chats for all these spaces
    const spaceIds = projects.map(p => p.id);
    const { data: spaceChats } = await supabase
      .from('space_chats')
      .select('space_id, chat_id')
      .in('space_id', spaceIds);
    
    if (!spaceChats || spaceChats.length === 0) {
      console.log('   ⚠️  No chats found, skipping');
      continue;
    }
    
    // Find unique chat IDs
    const chatIds = [...new Set(spaceChats.map(sc => sc.chat_id))];
    console.log(`   Found ${chatIds.length} unique chat(s)`);
    
    if (chatIds.length <= 1) {
      console.log('   ✅ Already using a shared chat, skipping');
      continue;
    }
    
    // Choose the oldest chat as the shared one (or first one)
    const primaryChatId = chatIds[0];
    const chatsToMerge = chatIds.slice(1);
    
    console.log(`   Primary chat: ${primaryChatId}`);
    console.log(`   Chats to merge: ${chatsToMerge.join(', ')}`);
    
    // Get all participants from all chats
    const { data: allParticipants } = await supabase
      .from('chat_participants')
      .select('user_id')
      .in('chat_id', chatIds);
    
    const uniqueUserIds = [...new Set(allParticipants?.map(p => p.user_id) || [])];
    console.log(`   Participants to add: ${uniqueUserIds.length}`);
    
    // Get all messages from chats to merge (we'll keep them in the primary chat)
    for (const chatIdToMerge of chatsToMerge) {
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chatIdToMerge);
      
      if (messages && messages.length > 0) {
        console.log(`   📝 Moving ${messages.length} message(s) from chat ${chatIdToMerge} to primary chat`);
        // Move messages to primary chat
        for (const message of messages) {
          const { error: moveError } = await supabase
            .from('chat_messages')
            .update({ chat_id: primaryChatId })
            .eq('id', message.id);
          
          if (moveError) {
            console.error(`     ❌ Error moving message ${message.id}:`, moveError);
          }
        }
      }
    }
    
    // Update all space_chats to point to primary chat
    for (const chatIdToMerge of chatsToMerge) {
      // Find spaces linked to this chat
      const { data: spacesToUpdate } = await supabase
        .from('space_chats')
        .select('space_id')
        .eq('chat_id', chatIdToMerge);
      
      if (spacesToUpdate) {
        for (const { space_id } of spacesToUpdate) {
          // Delete old link
          await supabase
            .from('space_chats')
            .delete()
            .eq('space_id', space_id)
            .eq('chat_id', chatIdToMerge);
          
          // Check if already linked to primary chat
          const { data: existingLink } = await supabase
            .from('space_chats')
            .select('id')
            .eq('space_id', space_id)
            .eq('chat_id', primaryChatId)
            .single();
          
          if (!existingLink) {
            // Create new link to primary chat
            await supabase
              .from('space_chats')
              .insert({ space_id, chat_id: primaryChatId });
          }
        }
      }
      
      // Delete merged chat
      await supabase
        .from('chats')
        .delete()
        .eq('id', chatIdToMerge);
      
      console.log(`   ✅ Merged and deleted chat ${chatIdToMerge}`);
    }
    
    // Ensure all users are participants in the primary chat
    for (const userId of uniqueUserIds) {
      const { data: existingParticipant } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', primaryChatId)
        .eq('user_id', userId)
        .single();
      
      if (!existingParticipant) {
        await supabase
          .from('chat_participants')
          .insert({ chat_id: primaryChatId, user_id: userId });
        console.log(`   ✅ Added user ${userId} as participant`);
      }
    }
    
    console.log(`   ✅ Consolidation complete for ${notionPageId}`);
  }
  
  console.log('\n✅ All chats consolidated!');
}

// Run consolidation
consolidateChats()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during consolidation:', error);
    process.exit(1);
  });


