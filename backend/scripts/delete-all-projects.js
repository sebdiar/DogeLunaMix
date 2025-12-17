/**
 * Script to delete ALL projects from the database
 * This will delete all spaces with category='project'
 * 
 * WARNING: This will delete ALL projects, including their tabs, chats, etc.
 * 
 * Usage: node scripts/delete-all-projects.js
 */

import supabase from '../config/database.js';

async function deleteAllProjects() {
  console.log('🗑️  Deleting ALL projects from database...\n');
  
  // Get all projects first to show what will be deleted
  const { data: allProjects, error: fetchError } = await supabase
    .from('spaces')
    .select('id, name, user_id, notion_page_id')
    .eq('category', 'project');
  
  if (fetchError) {
    console.error('❌ Error fetching projects:', fetchError);
    process.exit(1);
  }
  
  if (!allProjects || allProjects.length === 0) {
    console.log('✅ No projects found. Nothing to delete.');
    return;
  }
  
  console.log(`📦 Found ${allProjects.length} projects to delete:\n`);
  
  // Group by user
  const byUser = {};
  for (const proj of allProjects) {
    if (!byUser[proj.user_id]) {
      byUser[proj.user_id] = [];
    }
    byUser[proj.user_id].push(proj);
  }
  
  for (const [userId, projects] of Object.entries(byUser)) {
    console.log(`User ${userId}: ${projects.length} projects`);
  }
  
  console.log(`\n🗑️  Deleting all ${allProjects.length} projects...\n`);
  
  // Delete all projects (cascade will handle tabs, chats, etc.)
  const { error: deleteError } = await supabase
    .from('spaces')
    .delete()
    .eq('category', 'project');
  
  if (deleteError) {
    console.error('❌ Error deleting projects:', deleteError);
    process.exit(1);
  }
  
  console.log('✅ All projects deleted successfully!');
  
  // Verify deletion
  const { data: remainingProjects } = await supabase
    .from('spaces')
    .select('id')
    .eq('category', 'project');
  
  if (remainingProjects && remainingProjects.length > 0) {
    console.log(`⚠️  Warning: ${remainingProjects.length} projects still remain`);
  } else {
    console.log('✅ Verification: No projects remaining in database');
  }
}

// Run deletion
deleteAllProjects()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during deletion:', error);
    process.exit(1);
  });

