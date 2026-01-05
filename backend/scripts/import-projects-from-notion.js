/**
 * Import projects from Notion database - ONE TIME ONLY
 * Imports all projects from Notion and assigns them to a specific user (Sebastian)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';
import { queryNotionPages } from '../services/notion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function importProjectsFromNotion() {
  try {
    console.log('🚀 Starting Notion import for Sebastian...\n');
    
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
    
    // Query all pages from Notion
    const notionPages = await queryNotionPages(apiKey, databaseId);
    
    console.log(`📦 Found ${notionPages.length} pages in Notion\n`);
    
    if (notionPages.length === 0) {
      console.log('⚠️  No pages found in Notion database');
      process.exit(0);
    }
    
    // Check if projects already exist
    const { data: existingProjects } = await supabase
      .from('spaces')
      .select('id, name, notion_page_id')
      .eq('user_id', SEBASTIAN_USER_ID)
      .eq('category', 'project')
      .not('notion_page_id', 'is', null);
    
    if (existingProjects && existingProjects.length > 0) {
      console.log(`⚠️  Warning: Found ${existingProjects.length} existing projects for Sebastian`);
      console.log('   This script will skip projects that already exist (same notion_page_id)\n');
    }
    
    // Create a map of notion_page_id -> space_id for parent mapping
    const notionToSpaceId = new Map();
    
    // Sort pages: parents first (those without parent_id or with parent_id that's not in our list)
    // We'll do multiple passes to handle nested hierarchies
    const processed = new Set();
    const toProcess = [...notionPages];
    let pass = 1;
    
    while (toProcess.length > 0 && pass <= 10) { // Max 10 passes to avoid infinite loops
      console.log(`\n🔄 Pass ${pass}: Processing projects...`);
      let processedInThisPass = 0;
      const remaining = [];
      
      for (const page of toProcess) {
        // Skip if archived
        if (page.archived) {
          console.log(`   ⏭️  Skipping archived: ${page.name}`);
          processed.add(page.id);
          continue;
        }
        
        // Check if already exists
        const existing = existingProjects?.find(p => p.notion_page_id === page.id);
        if (existing) {
          console.log(`   ✅ Already exists: ${page.name}`);
          notionToSpaceId.set(page.id, existing.id);
          processed.add(page.id);
          continue;
        }
        
        // Get ALL parent IDs (handle both old format with parent_id and new format with parent_ids)
        const parentNotionIds = page.parent_ids || (page.parent_id ? [page.parent_id] : []);
        
        // Check if all parents are processed (or if it has no parents)
        const allParentsProcessed = parentNotionIds.length === 0 || 
                                    parentNotionIds.every(pid => 
                                      processed.has(pid) || 
                                      notionToSpaceId.has(pid) ||
                                      !notionPages.find(p => p.id === pid)
                                    );
        
        if (!allParentsProcessed) {
          remaining.push(page);
          continue;
        }
        
        // Find parent space_ids for ALL parents
        // parent_id is now a JSONB array, so we need to convert all parents to an array
        let parentSpaceIds = [];
        for (const parentNotionId of parentNotionIds) {
          if (notionToSpaceId.has(parentNotionId)) {
            parentSpaceIds.push(notionToSpaceId.get(parentNotionId));
          }
        }
        
        // Get tags from page (if available)
        const tags = page.tags || [];
        
        // Get icon data from page (if available)
        const iconData = page.icon || { type: null, emoji: null, url: null };
        let avatar_emoji = null;
        let avatar_photo = null;
        let avatar_color = null;
        
        if (iconData.type === 'emoji' && iconData.emoji) {
          avatar_emoji = iconData.emoji;
          avatar_color = '#4285f4'; // Default blue color for emoji
        } else if ((iconData.type === 'file' || iconData.type === 'external') && iconData.url) {
          avatar_photo = iconData.url;
        }
        
        // Get max position for this category and parent
        // For JSONB array, we need to check if the array contains the parent_id
        let maxPosSpace;
        if (parentSpaceIds.length > 0) {
          // Query for projects with this parent in the parent_id array
          // Use @> operator for JSONB array containment
          const { data: siblings } = await supabase
            .from('spaces')
            .select('position')
            .eq('user_id', SEBASTIAN_USER_ID)
            .eq('category', 'project')
            .contains('parent_id', parentSpaceIds[0])
            .order('position', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          maxPosSpace = siblings;
        } else {
          // Query for root-level projects (parent_id is empty array)
          const { data: rootProjects } = await supabase
            .from('spaces')
            .select('position')
            .eq('user_id', SEBASTIAN_USER_ID)
            .eq('category', 'project')
            .eq('parent_id', '[]')
            .order('position', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          maxPosSpace = rootProjects;
        }
        
        const position = maxPosSpace?.position != null ? maxPosSpace.position + 1 : 0;
        
        // Create space with parent_id as JSONB array
        const { data: newSpace, error: createError } = await supabase
          .from('spaces')
          .insert({
            user_id: SEBASTIAN_USER_ID,
            name: page.name,
            category: 'project',
            parent_id: parentSpaceIds, // JSONB array
            position: position,
            notion_page_id: page.id,
            notion_page_url: page.url,
            tags: tags, // JSONB array of tags
            avatar_emoji: avatar_emoji,
            avatar_photo: avatar_photo,
            avatar_color: avatar_color,
            archived: false,
            is_expanded: true
          })
          .select('id, name')
          .single();
        
        if (createError) {
          console.error(`   ❌ Error creating "${page.name}":`, createError.message);
          continue;
        }
        
        console.log(`   ✅ Created: ${newSpace.name}${parentSpaceIds.length > 0 ? ' (child)' : ''}`);
        notionToSpaceId.set(page.id, newSpace.id);
        processed.add(page.id);
        processedInThisPass++;
      }
      
      if (processedInThisPass === 0 && remaining.length > 0) {
        console.log(`   ⚠️  Warning: Could not process ${remaining.length} projects (circular dependencies?)`);
        // Try to create them anyway without parent
        for (const page of remaining) {
          // Get tags and icon data
          const tags = page.tags || [];
          const iconData = page.icon || { type: null, emoji: null, url: null };
          let avatar_emoji = null;
          let avatar_photo = null;
          let avatar_color = null;
          
          if (iconData.type === 'emoji' && iconData.emoji) {
            avatar_emoji = iconData.emoji;
            avatar_color = '#4285f4';
          } else if ((iconData.type === 'file' || iconData.type === 'external') && iconData.url) {
            avatar_photo = iconData.url;
          }
          
          const { data: newSpace, error: createError } = await supabase
            .from('spaces')
            .insert({
              user_id: SEBASTIAN_USER_ID,
              name: page.name,
              category: 'project',
              parent_id: [], // Force no parent (empty array)
              position: 0,
              notion_page_id: page.id,
              notion_page_url: page.url,
              tags: tags, // JSONB array of tags
              avatar_emoji: avatar_emoji,
              avatar_photo: avatar_photo,
              avatar_color: avatar_color,
              archived: false,
              is_expanded: true
            })
            .select('id, name')
            .single();
          
          if (!createError) {
            console.log(`   ✅ Created (no parent): ${newSpace.name}`);
            notionToSpaceId.set(page.id, newSpace.id);
            processed.add(page.id);
          }
        }
        break;
      }
      
      toProcess.length = 0;
      toProcess.push(...remaining);
      pass++;
    }
    
    console.log('\n✅ Import complete!');
    console.log(`📊 Total projects imported: ${notionToSpaceId.size}`);
    
  } catch (error) {
    console.error('❌ Import error:', error);
    process.exit(1);
  }
}

importProjectsFromNotion();


