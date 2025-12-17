/**
 * Script to revert the cleanup changes:
 * - Remove Raneem (423f3dd9-a4f0-4a93-bd9a-3044d343a4e0) from projects where she was added
 * - Remove duplicate tabs that were moved
 * 
 * Usage: node scripts/revert-cleanup.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function revertCleanup() {
  console.log('🔄 Reverting cleanup changes...\n');
  
  const raneemUserId = '423f3dd9-a4f0-4a93-bd9a-3044d343a4e0';
  
  // 1. Remove Raneem from all project chats where she's a participant (but not owner)
  console.log('1. Removing Raneem from project chats...');
  
  // Get all projects where Raneem is a participant
  const { data: spaceChats } = await supabase
    .from('space_chats')
    .select('space_id, chat_id, spaces!inner(user_id, category)')
    .eq('spaces.category', 'project');
  
  if (spaceChats) {
    for (const spaceChat of spaceChats) {
      // Check if Raneem is participant but not owner
      if (spaceChat.spaces.user_id !== raneemUserId) {
        const { data: participant } = await supabase
          .from('chat_participants')
          .select('id')
          .eq('chat_id', spaceChat.chat_id)
          .eq('user_id', raneemUserId)
          .single();
        
        if (participant) {
          await supabase
            .from('chat_participants')
            .delete()
            .eq('chat_id', spaceChat.chat_id)
            .eq('user_id', raneemUserId);
          console.log(`   ✅ Removed Raneem from project ${spaceChat.space_id}`);
        }
      }
    }
  }
  
  // 2. Find and remove duplicate tabs (tabs with same title and space_id)
  console.log('\n2. Finding duplicate tabs...');
  
  const { data: allTabs } = await supabase
    .from('tabs')
    .select('id, space_id, title, url, type, user_id, created_at')
    .order('created_at', { ascending: true });
  
  if (allTabs) {
    // Group tabs by space_id and title
    const tabsBySpaceAndTitle = new Map();
    allTabs.forEach(tab => {
      const key = `${tab.space_id}-${tab.title}`;
      if (!tabsBySpaceAndTitle.has(key)) {
        tabsBySpaceAndTitle.set(key, []);
      }
      tabsBySpaceAndTitle.get(key).push(tab);
    });
    
    // Find duplicates and keep only the first one
    let duplicatesRemoved = 0;
    for (const [key, tabs] of tabsBySpaceAndTitle) {
      if (tabs.length > 1) {
        // Keep the first (oldest), delete the rest
        const toDelete = tabs.slice(1);
        for (const tab of toDelete) {
          await supabase
            .from('tabs')
            .delete()
            .eq('id', tab.id);
          duplicatesRemoved++;
        }
        console.log(`   ✅ Removed ${toDelete.length} duplicate tab(s) for "${tabs[0].title}" in space ${tabs[0].space_id}`);
      }
    }
    
    console.log(`\n   Total duplicate tabs removed: ${duplicatesRemoved}`);
  }
  
  console.log('\n✅ Revert complete!');
}

// Run revert
revertCleanup()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during revert:', error);
    process.exit(1);
  });




