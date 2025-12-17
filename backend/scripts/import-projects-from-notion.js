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
        
        // Check if parent is processed (or if it has no parent)
        const canProcess = !page.parent_id || 
                          processed.has(page.parent_id) || 
                          notionToSpaceId.has(page.parent_id) ||
                          !notionPages.find(p => p.id === page.parent_id);
        
        if (!canProcess) {
          remaining.push(page);
          continue;
        }
        
        // Find parent space_id if parent exists
        let parentSpaceId = null;
        if (page.parent_id && notionToSpaceId.has(page.parent_id)) {
          parentSpaceId = notionToSpaceId.get(page.parent_id);
        }
        
        // Get max position for this category and parent
        const { data: maxPosSpace } = await supabase
          .from('spaces')
          .select('position')
          .eq('user_id', SEBASTIAN_USER_ID)
          .eq('category', 'project')
          .eq('parent_id', parentSpaceId || null)
          .order('position', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        
        const position = maxPosSpace?.position != null ? maxPosSpace.position + 1 : 0;
        
        // Create space
        const { data: newSpace, error: createError } = await supabase
          .from('spaces')
          .insert({
            user_id: SEBASTIAN_USER_ID,
            name: page.name,
            category: 'project',
            parent_id: parentSpaceId,
            position: position,
            notion_page_id: page.id,
            notion_page_url: page.url,
            archived: false,
            is_expanded: true
          })
          .select('id, name')
          .single();
        
        if (createError) {
          console.error(`   ❌ Error creating "${page.name}":`, createError.message);
          continue;
        }
        
        console.log(`   ✅ Created: ${newSpace.name}${parentSpaceId ? ' (child)' : ''}`);
        notionToSpaceId.set(page.id, newSpace.id);
        processed.add(page.id);
        processedInThisPass++;
      }
      
      if (processedInThisPass === 0 && remaining.length > 0) {
        console.log(`   ⚠️  Warning: Could not process ${remaining.length} projects (circular dependencies?)`);
        // Try to create them anyway without parent
        for (const page of remaining) {
          const { data: newSpace, error: createError } = await supabase
            .from('spaces')
            .insert({
              user_id: SEBASTIAN_USER_ID,
              name: page.name,
              category: 'project',
              parent_id: null, // Force no parent
              position: 0,
              notion_page_id: page.id,
              notion_page_url: page.url,
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

