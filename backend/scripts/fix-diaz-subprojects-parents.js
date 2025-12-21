/**
 * Script to fix parent_id of subprojects so they point to the correct parent space
 * for each user
 * 
 * This script:
 * 1. Finds all projects with parent_id pointing to a different user's space
 * 2. Updates parent_id to point to the same user's parent space
 * 
 * Usage: node scripts/fix-diaz-subprojects-parents.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixSubprojectParents() {
  console.log('🔍 Finding subprojects with incorrect parent_id...\n');
  
  // Get all projects with parent_id
  const { data: allProjects, error: fetchError } = await supabase
    .from('spaces')
    .select('id, name, user_id, parent_id, notion_page_id, category')
    .eq('category', 'project')
    .not('parent_id', 'is', null);
  
  if (fetchError) {
    console.error('❌ Error fetching projects:', fetchError);
    process.exit(1);
  }
  
  if (!allProjects || allProjects.length === 0) {
    console.log('✅ No projects with parent_id found.');
    return;
  }
  
  console.log(`📦 Found ${allProjects.length} projects with parent_id\n`);
  
  let fixedCount = 0;
  
  for (const project of allProjects) {
    // Get the parent space
    const { data: parent } = await supabase
      .from('spaces')
      .select('id, user_id, notion_page_id')
      .eq('id', project.parent_id)
      .single();
    
    if (!parent) {
      console.log(`⚠️  Project ${project.id} (${project.name}) has invalid parent_id ${project.parent_id}, skipping`);
      continue;
    }
    
    // Check if parent belongs to a different user
    if (parent.user_id !== project.user_id) {
      console.log(`\n🔧 Fixing project: ${project.name} (${project.id})`);
      console.log(`   Current parent: ${parent.id} (user: ${parent.user_id})`);
      console.log(`   Project user: ${project.user_id}`);
      
      // Find the correct parent space (same notion_page_id, same user_id as project)
      let correctParentId = null;
      
      if (parent.notion_page_id && project.notion_page_id) {
        // Both have notion_page_id, find parent with same notion_page_id and user_id
        const { data: correctParent } = await supabase
          .from('spaces')
          .select('id, name')
          .eq('notion_page_id', parent.notion_page_id)
          .eq('user_id', project.user_id)
          .eq('category', 'project')
          .single();
        
        if (correctParent) {
          correctParentId = correctParent.id;
          console.log(`   ✅ Found correct parent: ${correctParent.id} (${correctParent.name})`);
        } else {
          console.log(`   ⚠️  Could not find correct parent with notion_page_id ${parent.notion_page_id} for user ${project.user_id}`);
        }
      } else {
        // Try to find parent by name for same user (less reliable but better than nothing)
        const { data: parentWithName } = await supabase
          .from('spaces')
          .select('id, name')
          .eq('user_id', project.user_id)
          .eq('category', 'project')
          .eq('id', parent.id) // This won't work, parent belongs to different user
          .single();
        
        // This approach won't work because we need to match by notion_page_id
        console.log(`   ⚠️  Cannot fix: parent doesn't have notion_page_id`);
        continue;
      }
      
      if (correctParentId && correctParentId !== project.parent_id) {
        // Update parent_id
        const { error: updateError } = await supabase
          .from('spaces')
          .update({ parent_id: correctParentId })
          .eq('id', project.id);
        
        if (updateError) {
          console.error(`   ❌ Error updating parent_id:`, updateError);
        } else {
          console.log(`   ✅ Updated parent_id from ${project.parent_id} to ${correctParentId}`);
          fixedCount++;
        }
      }
    }
  }
  
  console.log(`\n✅ Fixed ${fixedCount} subprojects`);
}

// Run fix
fixSubprojectParents()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error during fix:', error);
    process.exit(1);
  });


