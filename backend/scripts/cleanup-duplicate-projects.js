/**
 * Script to clean up duplicate projects with the same notion_page_id
 * 
 * This script:
 * 1. Finds all projects with duplicate notion_page_id
 * 2. Keeps the oldest project (first created)
 * 3. Deletes duplicate projects (cascade will handle related records)
 * 
 * IMPORTANT: This script does NOT:
 * - Move tabs from duplicates to original
 * - Add users from duplicates as members
 * - Modify any existing data
 * 
 * Usage: node scripts/cleanup-duplicate-projects.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function cleanupDuplicateProjects() {
  console.log('🔍 Finding duplicate projects...\n');
  
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
  
  // Group by notion_page_id
  const projectsByNotionId = new Map();
  allProjects.forEach(project => {
    if (!projectsByNotionId.has(project.notion_page_id)) {
      projectsByNotionId.set(project.notion_page_id, []);
    }
    projectsByNotionId.get(project.notion_page_id).push(project);
  });
  
  // Find duplicates (more than one project with same notion_page_id)
  const duplicates = [];
  projectsByNotionId.forEach((projects, notionPageId) => {
    if (projects.length > 1) {
      duplicates.push({ notionPageId, projects });
    }
  });
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicate projects found.');
    return;
  }
  
  console.log(`📦 Found ${duplicates.length} sets of duplicate projects:\n`);
  
  for (const { notionPageId, projects } of duplicates) {
    // Sort by created_at to keep the oldest
    projects.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const original = projects[0];
    const duplicatesToRemove = projects.slice(1);
    
    console.log(`\n📄 Notion Page ID: ${notionPageId}`);
    console.log(`   Project: "${original.name}"`);
    console.log(`   Original (keeping): ${original.id} (owner: ${original.user_id}, created: ${original.created_at})`);
    console.log(`   Duplicates to remove: ${duplicatesToRemove.length}`);
    
    for (const duplicate of duplicatesToRemove) {
      console.log(`     - ${duplicate.id} (owner: ${duplicate.user_id}, created: ${duplicate.created_at})`);
      
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
cleanupDuplicateProjects()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  });

