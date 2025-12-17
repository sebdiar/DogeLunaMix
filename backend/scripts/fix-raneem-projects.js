/**
 * Script to fix Raneem's projects:
 * 1. Remove Raneem from ALL projects where she's a member (not owner)
 * 2. Delete ALL projects owned by Raneem EXCEPT "Compartido" if it exists
 * 3. Keep only ONE "Compartido" project (the oldest one owned by Sebastian)
 * 
 * Usage: node scripts/fix-raneem-projects.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixRaneemProjects() {
  console.log('🔧 Fixing Raneem projects...\n');
  
  const raneemUserId = '423f3dd9-a4f0-4a93-bd9a-3044d343a4e0';
  const sebastianUserId = 'dbc08b48-54d8-4aea-8444-f750ee515b02';
  
  // 1. Remove Raneem from ALL project chats where she's a participant (but not owner)
  console.log('1. Removing Raneem from all project chats...');
  
  // Get all project chats
  const { data: allSpaceChats } = await supabase
    .from('space_chats')
    .select('space_id, chat_id, spaces!inner(user_id, category, name)')
    .eq('spaces.category', 'project');
  
  if (allSpaceChats) {
    let removedCount = 0;
    for (const spaceChat of allSpaceChats) {
      // Only remove if Raneem is NOT the owner
      if (spaceChat.spaces.user_id !== raneemUserId) {
        const { error } = await supabase
          .from('chat_participants')
          .delete()
          .eq('chat_id', spaceChat.chat_id)
          .eq('user_id', raneemUserId);
        
        if (!error) {
          removedCount++;
        }
      }
    }
    console.log(`   ✅ Removed Raneem from ${removedCount} project chats`);
  }
  
  // 2. Find all "Compartido" projects
  console.log('\n2. Finding "Compartido" projects...');
  
  const { data: compartidoProjects } = await supabase
    .from('spaces')
    .select('id, user_id, name, created_at, notion_page_id')
    .eq('category', 'project')
    .ilike('name', '%compartido%')
    .order('created_at', { ascending: true });
  
  if (compartidoProjects && compartidoProjects.length > 0) {
    console.log(`   Found ${compartidoProjects.length} "Compartido" project(s):`);
    compartidoProjects.forEach(p => {
      console.log(`     - ${p.id} (owner: ${p.user_id === sebastianUserId ? 'Sebastian' : 'Raneem'}, created: ${p.created_at})`);
    });
    
    // Keep only the oldest one owned by Sebastian
    const sebastianCompartido = compartidoProjects.find(p => p.user_id === sebastianUserId);
    
    if (sebastianCompartido) {
      console.log(`\n   ✅ Keeping Sebastian's "Compartido": ${sebastianCompartido.id}`);
      
      // Delete all other "Compartido" projects
      const toDelete = compartidoProjects.filter(p => p.id !== sebastianCompartido.id);
      for (const project of toDelete) {
        const { error } = await supabase
          .from('spaces')
          .delete()
          .eq('id', project.id);
        
        if (!error) {
          console.log(`   ✅ Deleted duplicate "Compartido": ${project.id}`);
        } else {
          console.error(`   ❌ Error deleting ${project.id}:`, error);
        }
      }
    } else {
      // No Sebastian "Compartido" found, delete all Raneem's
      const raneemCompartido = compartidoProjects.filter(p => p.user_id === raneemUserId);
      for (const project of raneemCompartido) {
        const { error } = await supabase
          .from('spaces')
          .delete()
          .eq('id', project.id);
        
        if (!error) {
          console.log(`   ✅ Deleted Raneem's "Compartido": ${project.id}`);
        }
      }
    }
  }
  
  // 3. Delete ALL other projects owned by Raneem
  console.log('\n3. Deleting all other projects owned by Raneem...');
  
  const { data: raneemProjects } = await supabase
    .from('spaces')
    .select('id, name')
    .eq('category', 'project')
    .eq('user_id', raneemUserId);
  
  if (raneemProjects && raneemProjects.length > 0) {
    console.log(`   Found ${raneemProjects.length} project(s) owned by Raneem:`);
    raneemProjects.forEach(p => {
      console.log(`     - ${p.name} (${p.id})`);
    });
    
    for (const project of raneemProjects) {
      const { error } = await supabase
        .from('spaces')
        .delete()
        .eq('id', project.id);
      
      if (!error) {
        console.log(`   ✅ Deleted: ${project.name}`);
      } else {
        console.error(`   ❌ Error deleting ${project.name}:`, error);
      }
    }
  } else {
    console.log('   ✅ No projects owned by Raneem found');
  }
  
  console.log('\n✅ Fix complete!');
  console.log('\n📋 Summary:');
  console.log('   - Raneem removed from all project chats');
  console.log('   - Only ONE "Compartido" project remains (Sebastian\'s)');
  console.log('   - All other Raneem projects deleted');
}

// Run fix
fixRaneemProjects()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during fix:', error);
    process.exit(1);
  });




