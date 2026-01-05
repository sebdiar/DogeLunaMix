/**
 * Sync tags and icons from Notion for all existing projects
 * This updates tags and icons to match Notion
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';
import { queryNotionPages, getNotionPageIcon } from '../services/notion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function syncTagsAndIconsFromNotion() {
  try {
    console.log('🔄 Syncing tags and icons from Notion...\n');
    
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
    
    // Query all pages from Notion (this now gets tags and icons)
    const notionPages = await queryNotionPages(apiKey, databaseId);
    
    console.log(`📦 Found ${notionPages.length} pages in Notion\n`);
    
    // Get all existing projects from database
    const { data: existingProjects, error: fetchError } = await supabase
      .from('spaces')
      .select('id, name, notion_page_id, tags, avatar_emoji, avatar_photo, avatar_color, user_id')
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
    
    let updatedTagsCount = 0;
    let updatedIconsCount = 0;
    let skippedCount = 0;
    
    console.log('🔄 Updating tags and icons...\n');
    
    for (const notionPage of notionPages) {
      // Find corresponding database project
      const dbProject = dbProjectByNotionId.get(notionPage.id);
      
      if (!dbProject) {
        // Project doesn't exist in database, skip
        continue;
      }
      
      let hasChanges = false;
      const updates = {};
      
      // Compare tags
      const notionTags = notionPage.tags || [];
      const currentTags = dbProject.tags || [];
      let currentTagsArray = currentTags;
      if (typeof currentTags === 'string') {
        try {
          currentTagsArray = JSON.parse(currentTags);
        } catch (e) {
          currentTagsArray = [];
        }
      }
      if (!Array.isArray(currentTagsArray)) {
        currentTagsArray = [];
      }
      
      // Sort arrays for comparison
      const notionTagsSorted = [...notionTags].sort();
      const currentTagsSorted = [...currentTagsArray].sort();
      
      const tagsChanged = JSON.stringify(notionTagsSorted) !== JSON.stringify(currentTagsSorted);
      
      if (tagsChanged) {
        updates.tags = notionTags;
        hasChanges = true;
      }
      
      // Compare icons - get icon from Notion page directly
      let iconData = { type: null, emoji: null, url: null };
      try {
        iconData = await getNotionPageIcon(apiKey, notionPage.id);
      } catch (err) {
        console.log(`   ⚠️  Could not get icon for "${dbProject.name}":`, err.message);
      }
      
      let avatar_emoji = null;
      let avatar_photo = null;
      let avatar_color = null;
      
      if (iconData.type === 'emoji' && iconData.emoji) {
        avatar_emoji = iconData.emoji;
        avatar_color = '#4285f4'; // Default blue color
      } else if ((iconData.type === 'file' || iconData.type === 'external') && iconData.url) {
        avatar_photo = iconData.url;
      }
      
      // Check if icon changed
      const iconChanged = 
        dbProject.avatar_emoji !== avatar_emoji ||
        dbProject.avatar_photo !== avatar_photo ||
        dbProject.avatar_color !== avatar_color;
      
      if (iconChanged) {
        updates.avatar_emoji = avatar_emoji;
        updates.avatar_photo = avatar_photo;
        updates.avatar_color = avatar_color;
        hasChanges = true;
      }
      
      if (!hasChanges) {
        skippedCount++;
        continue; // No changes needed
      }
      
      // Update project
      console.log(`   🔄 Updating "${dbProject.name}"`);
      if (tagsChanged) {
        console.log(`      Tags: ${JSON.stringify(currentTagsArray)} → ${JSON.stringify(notionTags)}`);
        updatedTagsCount++;
      }
      if (iconChanged) {
        if (avatar_emoji) {
          console.log(`      Icon: ${avatar_emoji}`);
        } else if (avatar_photo) {
          console.log(`      Icon: ${avatar_photo.substring(0, 50)}...`);
        } else {
          console.log(`      Icon: (none)`);
        }
        updatedIconsCount++;
      }
      
      updates.updated_at = new Date().toISOString();
      
      const { error: updateError } = await supabase
        .from('spaces')
        .update(updates)
        .eq('id', dbProject.id);
      
      if (updateError) {
        console.error(`      ❌ Error: ${updateError.message}`);
      } else {
        console.log(`      ✅ Updated`);
      }
    }
    
    console.log(`\n✅ Sync complete!`);
    console.log(`📊 Updated tags: ${updatedTagsCount} projects`);
    console.log(`🎨 Updated icons: ${updatedIconsCount} projects`);
    console.log(`⏭️  Skipped (no changes): ${skippedCount} projects`);
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    process.exit(1);
  }
}

syncTagsAndIconsFromNotion()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

