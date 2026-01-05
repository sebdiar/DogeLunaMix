/**
 * Script to sync tags from Notion for all existing projects
 * This will fetch all projects from the database and update their tags from Notion
 */

import supabase from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY not found in environment variables');
  process.exit(1);
}

if (!NOTION_DATABASE_ID) {
  console.error('❌ NOTION_DATABASE_ID not found in environment variables');
  process.exit(1);
}

/**
 * Fetch page from Notion and extract tags
 */
async function getTagsFromNotionPage(pageId) {
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch page ${pageId} from Notion:`, response.statusText);
      return [];
    }

    const page = await response.json();

    // Extract tags from "Tag" property (multi-select)
    let tags = [];
    const tagProp = page.properties?.Tag;
    if (tagProp && tagProp.type === 'multi_select' && tagProp.multi_select && tagProp.multi_select.length > 0) {
      tags = tagProp.multi_select.map(item => item.name || item).filter(Boolean);
    }

    return tags;
  } catch (error) {
    console.error(`Error fetching tags for page ${pageId}:`, error);
    return [];
  }
}

/**
 * Sync tags for all projects
 */
async function syncTagsFromNotion() {
  console.log('🔄 Starting tags sync from Notion...\n');

  // Get all projects with notion_page_id
  const { data: projects, error } = await supabase
    .from('spaces')
    .select('id, name, notion_page_id, user_id, tags')
    .eq('category', 'project')
    .not('notion_page_id', 'is', null);

  if (error) {
    console.error('❌ Error fetching projects:', error);
    process.exit(1);
  }

  if (!projects || projects.length === 0) {
    console.log('⚠️  No projects found with notion_page_id');
    return;
  }

  console.log(`📋 Found ${projects.length} projects to sync\n`);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const project of projects) {
    if (!project.notion_page_id) {
      skippedCount++;
      continue;
    }

    try {
      console.log(`🔄 Syncing tags for "${project.name}" (${project.id})...`);
      
      const tags = await getTagsFromNotionPage(project.notion_page_id);
      
      console.log(`  📌 Tags from Notion:`, tags);
      console.log(`  📌 Current tags in DB:`, project.tags || []);

      // Update tags in database
      const { error: updateError } = await supabase
        .from('spaces')
        .update({
          tags: tags,
          updated_at: new Date().toISOString()
        })
        .eq('id', project.id);

      if (updateError) {
        console.error(`  ❌ Error updating tags:`, updateError);
        errorCount++;
      } else {
        console.log(`  ✅ Updated tags successfully\n`);
        successCount++;
      }
    } catch (error) {
      console.error(`  ❌ Error syncing tags for "${project.name}":`, error);
      errorCount++;
    }
  }

  console.log('\n📊 Sync Summary:');
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log(`  ⏭️  Skipped: ${skippedCount}`);
  console.log(`  📋 Total: ${projects.length}`);
}

// Run the sync
syncTagsFromNotion()
  .then(() => {
    console.log('\n✅ Tags sync completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Tags sync failed:', error);
    process.exit(1);
  });

