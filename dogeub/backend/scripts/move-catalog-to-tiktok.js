/**
 * Script to move Catalog project inside TikTok
 * 
 * This script:
 * 1. Finds "Catalog" project (the one not already under TikTok)
 * 2. Finds "TikTok" project
 * 3. Updates Catalog's parent_id to TikTok's id
 * 
 * Usage: node backend/scripts/move-catalog-to-tiktok.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function moveCatalogToTikTok() {
  console.log('🔍 Finding Catalog and TikTok projects...\n');
  
  // Find all "Catalog" projects
  const { data: catalogProjects, error: catalogError } = await supabase
    .from('spaces')
    .select('id, name, user_id, parent_id, category')
    .ilike('name', 'Catalog')
    .eq('category', 'project');
  
  if (catalogError) {
    console.error('❌ Error fetching Catalog projects:', catalogError);
    process.exit(1);
  }
  
  if (!catalogProjects || catalogProjects.length === 0) {
    console.log('❌ No Catalog project found.');
    process.exit(1);
  }
  
  console.log(`📦 Found ${catalogProjects.length} Catalog project(s):`);
  catalogProjects.forEach(p => {
    console.log(`   - ${p.name} (ID: ${p.id}, parent_id: ${p.parent_id || 'null'})`);
  });
  
  // Find "TikTok" project
  const { data: tiktokProjects, error: tiktokError } = await supabase
    .from('spaces')
    .select('id, name, user_id, parent_id, category')
    .ilike('name', 'TikTok')
    .eq('category', 'project');
  
  if (tiktokError) {
    console.error('❌ Error fetching TikTok project:', tiktokError);
    process.exit(1);
  }
  
  if (!tiktokProjects || tiktokProjects.length === 0) {
    console.log('❌ No TikTok project found.');
    process.exit(1);
  }
  
  // Get the first TikTok project (assuming there's only one)
  const tiktok = tiktokProjects[0];
  console.log(`\n✅ Found TikTok project: ${tiktok.name} (ID: ${tiktok.id})\n`);
  
  // Find "Amazon" project to revert the wrong Catalog back
  const { data: amazonProjects, error: amazonError } = await supabase
    .from('spaces')
    .select('id, name, user_id, parent_id, category')
    .ilike('name', 'Amazon')
    .eq('category', 'project');
  
  if (amazonError) {
    console.error('❌ Error fetching Amazon project:', amazonError);
    process.exit(1);
  }
  
  if (!amazonProjects || amazonProjects.length === 0) {
    console.log('⚠️  No Amazon project found (might not need to revert).');
  } else {
    const amazon = amazonProjects[0];
    
    // Find the Catalog that's currently under TikTok but should be under Amazon
    const wrongCatalog = catalogProjects.find(c => c.parent_id === tiktok.id);
    
    if (wrongCatalog) {
      console.log(`\n🔄 Reverting wrong Catalog back to Amazon...`);
      console.log(`   Catalog ID: ${wrongCatalog.id}`);
      console.log(`   Moving from TikTok back to Amazon\n`);
      
      const { error: revertError } = await supabase
        .from('spaces')
        .update({ parent_id: amazon.id })
        .eq('id', wrongCatalog.id);
      
      if (revertError) {
        console.error('❌ Error reverting Catalog:', revertError);
        process.exit(1);
      }
      
      console.log('✅ Reverted: Catalog moved back to Amazon\n');
    }
  }
  
  // Find the Catalog that has NO parent_id (the one we want to move)
  const catalogToMove = catalogProjects.find(c => !c.parent_id);
  
  if (!catalogToMove) {
    console.log('❌ Could not find Catalog without parent_id to move.');
    process.exit(1);
  }
  
  console.log(`📋 Moving Catalog project: ${catalogToMove.name} (ID: ${catalogToMove.id})`);
  console.log(`   Current parent_id: ${catalogToMove.parent_id || 'null'}`);
  console.log(`   New parent_id: ${tiktok.id} (TikTok)\n`);
  
  // Update Catalog's parent_id to TikTok's id
  const { data: updated, error: updateError } = await supabase
    .from('spaces')
    .update({ parent_id: tiktok.id })
    .eq('id', catalogToMove.id)
    .select('id, name, parent_id')
    .single();
  
  if (updateError) {
    console.error('❌ Error updating Catalog parent_id:', updateError);
    process.exit(1);
  }
  
  console.log('✅ Successfully moved Catalog inside TikTok!');
  console.log(`   Updated: ${updated.name} (ID: ${updated.id}, parent_id: ${updated.parent_id})\n`);
  
  process.exit(0);
}

moveCatalogToTikTok().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

