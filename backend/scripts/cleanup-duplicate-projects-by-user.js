/**
 * Script to clean up duplicate projects with the same notion_page_id PER USER
 * 
 * This script:
 * 1. Finds all projects with duplicate notion_page_id for the SAME user
 * 2. Keeps the oldest project (first created) for each user
 * 3. Deletes duplicate projects for each user (cascade will handle related records)
 * 
 * IMPORTANT: Different users CAN have their own copy of the same Notion project.
 * This script only removes duplicates within the same user's projects.
 * 
 * Usage: node scripts/cleanup-duplicate-projects-by-user.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function cleanupDuplicateProjectsByUser() {
  console.log('🔍 Finding duplicate projects per user...\n');
  
  // Find all projects with notion_page_id
  const { data: allProjects, error: fetchError } = await supabase
    .from('spaces')
    .select('id, notion_page_id, user_id, name, created_at')
    .eq('category', 'project')
    .not('notion_page_id', 'is', null)
    .order('created_at', { ascending: true });
  
  if (fetchError) {
    console.error('❌ Error fetching projects:', fetchError);
    process.exit(1);
  }
  
  if (!allProjects || allProjects.length === 0) {
    console.log('✅ No projects with notion_page_id found.');
    return;
  }
  
  // Group by (user_id, notion_page_id) combination
  const projectsByUserAndNotionId = new Map();
  allProjects.forEach(project => {
    const key = `${project.user_id}::${project.notion_page_id}`;
    if (!projectsByUserAndNotionId.has(key)) {
      projectsByUserAndNotionId.set(key, []);
    }
    projectsByUserAndNotionId.get(key).push(project);
  });
  
  // Find duplicates (more than one project with same notion_page_id for the same user)
  const duplicates = [];
  projectsByUserAndNotionId.forEach((projects, key) => {
    if (projects.length > 1) {
      const [userId, notionPageId] = key.split('::');
      duplicates.push({ userId, notionPageId, projects });
    }
  });
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicate projects found (per user).');
    return;
  }
  
  console.log(`📦 Found ${duplicates.length} sets of duplicate projects (per user):\n`);
  
  for (const { userId, notionPageId, projects } of duplicates) {
    // Sort by created_at to keep the oldest
    projects.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const original = projects[0];
    const duplicatesToRemove = projects.slice(1);
    
    console.log(`\n📄 User: ${userId}`);
    console.log(`   Notion Page ID: ${notionPageId}`);
    console.log(`   Project: "${original.name}"`);
    console.log(`   Original (keeping): ${original.id} (created: ${original.created_at})`);
    console.log(`   Duplicates to remove: ${duplicatesToRemove.length}`);
    
    for (const duplicate of duplicatesToRemove) {
      console.log(`     - ${duplicate.id} (created: ${duplicate.created_at})`);
      
      // Delete duplicate project (cascade will handle related records: tabs, chats, etc.)
      const { error: deleteError } = await supabase
        .from('spaces')
        .delete()
        .eq('id', duplicate.id);
      
      if (deleteError) {
        console.error(`     ❌ Error deleting duplicate project ${duplicate.id}:`, deleteError);
      } else {
        console.log(`     ✅ Deleted duplicate project ${duplicate.id} (and all related data)`);
      }
    }
  }
  
  console.log('\n✅ Cleanup complete!');
}

// Run cleanup
cleanupDuplicateProjectsByUser()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  });

