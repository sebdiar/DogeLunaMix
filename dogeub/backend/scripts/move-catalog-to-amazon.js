/**
 * Script to move Catalog project inside Amazon
 * 
 * This script:
 * 1. Finds "Catalog" project (the one not already under Amazon)
 * 2. Finds "Amazon" project
 * 3. Updates Catalog's parent_id to Amazon's id
 * 
 * Usage: node backend/scripts/move-catalog-to-amazon.js
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function moveCatalogToAmazon() {
  console.log('🔍 Finding Catalog and Amazon projects...\n');
  
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
  
  // Find "Amazon" project
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
    console.log('❌ No Amazon project found.');
    process.exit(1);
  }
  
  // Get the first Amazon project (assuming there's only one)
  const amazon = amazonProjects[0];
  console.log(`\n✅ Found Amazon project: ${amazon.name} (ID: ${amazon.id})\n`);
  
  // Find the Catalog that's NOT already under Amazon
  // The one we want to move is likely the one with parent_id != amazon.id or null
  let catalogToMove = catalogProjects.find(c => c.parent_id !== amazon.id);
  
  // If all are under Amazon or we can't determine, use the first one that's not under Amazon
  if (!catalogToMove) {
    catalogToMove = catalogProjects.find(c => !c.parent_id) || catalogProjects[0];
  }
  
  if (!catalogToMove) {
    console.log('❌ Could not determine which Catalog to move.');
    process.exit(1);
  }
  
  console.log(`📋 Moving Catalog project: ${catalogToMove.name} (ID: ${catalogToMove.id})`);
  console.log(`   Current parent_id: ${catalogToMove.parent_id || 'null'}`);
  console.log(`   New parent_id: ${amazon.id} (Amazon)\n`);
  
  // Update Catalog's parent_id to Amazon's id
  const { data: updated, error: updateError } = await supabase
    .from('spaces')
    .update({ parent_id: amazon.id })
    .eq('id', catalogToMove.id)
    .select('id, name, parent_id')
    .single();
  
  if (updateError) {
    console.error('❌ Error updating Catalog parent_id:', updateError);
    process.exit(1);
  }
  
  console.log('✅ Successfully moved Catalog inside Amazon!');
  console.log(`   Updated: ${updated.name} (ID: ${updated.id}, parent_id: ${updated.parent_id})\n`);
  
  process.exit(0);
}

moveCatalogToAmazon().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});

