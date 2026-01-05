/**
 * Sync parent-child relationships from Notion for all existing projects
 * This updates parent_id arrays to match Notion's "Parent item" relation property
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';
import { queryNotionPages, getNotionPageParents } from '../services/notion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function syncParentsFromNotion() {
  try {
    console.log('🔄 Syncing parent relationships from Notion...\n');
    
    // Verify user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', SEBASTIAN_USER_ID)
      .single();
    
    if (userError || !user) {
      console.error('❌ Error: Sebastian user not found');
      process.exit(1);
    }
    
    console.log(`✅ User found: ${user.name} (${user.email})\n`);
    
    // Get Notion config
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;
    
    if (!apiKey || !databaseId) {
      console.error('❌ Error: NOTION_API_KEY and NOTION_DATABASE_ID must be set in .env');
      process.exit(1);
    }
    
    console.log('📥 Querying Notion database...\n');
    
    // Query all pages from Notion (this now gets ALL parents)
    const notionPages = await queryNotionPages(apiKey, databaseId);
    
    console.log(`📦 Found ${notionPages.length} pages in Notion\n`);
    
    // Get all existing projects from database
    const { data: existingProjects, error: fetchError } = await supabase
      .from('spaces')
      .select('id, name, notion_page_id, parent_id, user_id')
      .eq('user_id', SEBASTIAN_USER_ID)
      .eq('category', 'project')
      .not('notion_page_id', 'is', null);
    
    if (fetchError) {
      console.error('❌ Error fetching projects:', fetchError);
      process.exit(1);
    }
    
    console.log(`📊 Found ${existingProjects.length} existing projects in database\n`);
    
    // Create maps for lookup
    const notionPageById = new Map(notionPages.map(p => [p.id, p]));
    const dbProjectByNotionId = new Map(existingProjects.map(p => [p.notion_page_id, p]));
    const dbProjectById = new Map(existingProjects.map(p => [p.id, p]));
    
    // Create notion_page_id -> db_id map for parent mapping
    const notionToDbId = new Map();
    for (const dbProject of existingProjects) {
      if (dbProject.notion_page_id) {
        notionToDbId.set(dbProject.notion_page_id, dbProject.id);
      }
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    console.log('🔄 Updating parent relationships...\n');
    
    for (const notionPage of notionPages) {
      // Find corresponding database project
      const dbProject = dbProjectByNotionId.get(notionPage.id);
      
      if (!dbProject) {
        // Project doesn't exist in database, skip
        continue;
      }
      
      // Get ALL parent IDs from Notion (using parent_ids array if available, otherwise parent_id)
      const parentNotionIds = notionPage.parent_ids || (notionPage.parent_id ? [notionPage.parent_id] : []);
      
      // Convert Notion parent IDs to database parent IDs
      const parentDbIds = [];
      for (const parentNotionId of parentNotionIds) {
        const parentDbId = notionToDbId.get(parentNotionId);
        if (parentDbId) {
          parentDbIds.push(parentDbId);
        } else {
          console.log(`   ⚠️  Parent Notion ID ${parentNotionId} not found in database for project "${dbProject.name}"`);
        }
      }
      
      // Compare current parent_id with new parent_id array
      const currentParentIds = Array.isArray(dbProject.parent_id) 
        ? dbProject.parent_id 
        : (dbProject.parent_id ? [dbProject.parent_id] : []);
      
      // Check if they're different (compare arrays)
      const currentSorted = [...currentParentIds].sort();
      const newSorted = [...parentDbIds].sort();
      const areDifferent = currentSorted.length !== newSorted.length || 
                          currentSorted.some((id, idx) => id !== newSorted[idx]);
      
      if (!areDifferent) {
        skippedCount++;
        continue; // No change needed
      }
      
      // Update parent_id in database
      console.log(`   🔄 Updating "${dbProject.name}"`);
      console.log(`      Current parents: ${JSON.stringify(currentParentIds)}`);
      console.log(`      New parents: ${JSON.stringify(parentDbIds)}`);
      
      const { error: updateError } = await supabase
        .from('spaces')
        .update({
          parent_id: parentDbIds, // JSONB array
          updated_at: new Date().toISOString()
        })
        .eq('id', dbProject.id);
      
      if (updateError) {
        console.error(`      ❌ Error: ${updateError.message}`);
      } else {
        console.log(`      ✅ Updated`);
        updatedCount++;
      }
    }
    
    console.log(`\n✅ Sync complete!`);
    console.log(`📊 Updated: ${updatedCount} projects`);
    console.log(`⏭️  Skipped (no changes): ${skippedCount} projects`);
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    process.exit(1);
  }
}

syncParentsFromNotion()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

