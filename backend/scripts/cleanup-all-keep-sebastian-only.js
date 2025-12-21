/**
 * Script to clean up all duplicate projects and keep only Sebastian's projects
 * 
 * This script:
 * 1. For each notion_page_id, keeps only Sebastian's project (oldest if duplicates)
 * 2. Deletes all projects from other users
 * 3. Deletes all duplicate projects for Sebastian
 * 
 * IMPORTANT: This will DELETE all data from other users and duplicates!
 * 
 * Usage: node scripts/cleanup-all-keep-sebastian-only.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function cleanupAllKeepSebastian() {
  console.log('🧹 Cleaning up all projects, keeping only Sebastian\'s...\n');
  console.log(`Sebastian User ID: ${SEBASTIAN_USER_ID}\n`);
  
  // 1. Get all projects with notion_page_id
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
  
  console.log(`📦 Found ${allProjects.length} projects with notion_page_id\n`);
  
  // 2. Group by notion_page_id
  const projectsByNotionId = new Map();
  allProjects.forEach(project => {
    if (!projectsByNotionId.has(project.notion_page_id)) {
      projectsByNotionId.set(project.notion_page_id, []);
    }
    projectsByNotionId.get(project.notion_page_id).push(project);
  });
  
  // 3. For each notion_page_id, keep only Sebastian's oldest project
  const projectsToDelete = [];
  const projectsToKeep = new Set();
  
  for (const [notionPageId, projects] of projectsByNotionId.entries()) {
    // Separate by user
    const sebastianProjects = projects.filter(p => p.user_id === SEBASTIAN_USER_ID);
    const otherUsersProjects = projects.filter(p => p.user_id !== SEBASTIAN_USER_ID);
    
    // Delete all projects from other users
    otherUsersProjects.forEach(p => projectsToDelete.push(p));
    
    // For Sebastian's projects, keep only the oldest
    if (sebastianProjects.length > 0) {
      sebastianProjects.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const keepProject = sebastianProjects[0];
      projectsToKeep.add(keepProject.id);
      
      // Mark duplicates for deletion
      sebastianProjects.slice(1).forEach(p => projectsToDelete.push(p));
      
      console.log(`✅ Keeping: "${keepProject.name}" (${keepProject.id}) - ${sebastianProjects.length - 1} duplicate(s) will be deleted`);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Projects to keep: ${projectsToKeep.size}`);
  console.log(`   Projects to delete: ${projectsToDelete.length}\n`);
  
  if (projectsToDelete.length === 0) {
    console.log('✅ No duplicates found. Nothing to delete.');
    return;
  }
  
  // 4. Delete all duplicate/other user projects
  console.log('🗑️  Deleting projects...\n');
  
  for (const project of projectsToDelete) {
    console.log(`   Deleting: "${project.name}" (${project.id}) - user: ${project.user_id === SEBASTIAN_USER_ID ? 'Sebastian (duplicate)' : 'Other user'}`);
    
    const { error: deleteError } = await supabase
      .from('spaces')
      .delete()
      .eq('id', project.id);
    
    if (deleteError) {
      console.error(`     ❌ Error: ${deleteError.message}`);
    } else {
      console.log(`     ✅ Deleted`);
    }
  }
  
  console.log('\n✅ Cleanup complete!');
  
  // 5. Verify result
  const { data: remainingProjects } = await supabase
    .from('spaces')
    .select('id, name, user_id, notion_page_id')
    .eq('category', 'project')
    .not('notion_page_id', 'is', null);
  
  const byNotionId = new Map();
  remainingProjects?.forEach(p => {
    if (!byNotionId.has(p.notion_page_id)) {
      byNotionId.set(p.notion_page_id, []);
    }
    byNotionId.get(p.notion_page_id).push(p);
  });
  
  let hasDuplicates = false;
  for (const [notionId, projects] of byNotionId.entries()) {
    if (projects.length > 1) {
      hasDuplicates = true;
      console.log(`\n⚠️  Still has duplicates for notion_page_id ${notionId}: ${projects.length}`);
    }
  }
  
  if (!hasDuplicates) {
    console.log('\n✅ No duplicates remaining. All projects belong to Sebastian.');
  }
}

// Run cleanup
cleanupAllKeepSebastian()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  });


