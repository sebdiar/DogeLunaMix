/**
 * Check which projects are in Notion but not in the database
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import supabase from '../config/database.js';
import { queryNotionPages } from '../services/notion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const SEBASTIAN_USER_ID = 'dbc08b48-54d8-4aea-8444-f750ee515b02';

async function checkMissingProjects() {
  console.log('🔍 Checking for missing projects...\n');
  
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  
  if (!apiKey || !databaseId) {
    console.error('❌ Error: NOTION_API_KEY and NOTION_DATABASE_ID must be set in .env');
    process.exit(1);
  }
  
  // Get all projects from database
  const { data: dbProjects, error: dbError } = await supabase
    .from('spaces')
    .select('id, name, notion_page_id')
    .eq('user_id', SEBASTIAN_USER_ID)
    .eq('category', 'project')
    .not('notion_page_id', 'is', null);
  
  if (dbError) {
    console.error('❌ Error fetching database projects:', dbError);
    process.exit(1);
  }
  
  console.log(`📊 Database projects: ${dbProjects?.length || 0}\n`);
  
  // Get all pages from Notion
  console.log('📥 Querying Notion database...\n');
  const notionPages = await queryNotionPages(apiKey, databaseId);
  
  console.log(`📦 Notion pages: ${notionPages.length}\n`);
  
  // Create a set of existing notion_page_ids
  const existingNotionIds = new Set(dbProjects?.map(p => p.notion_page_id) || []);
  
  // Find missing projects (in Notion but not in database, and not archived)
  const missingProjects = notionPages.filter(page => {
    return !existingNotionIds.has(page.id) && !page.archived;
  });
  
  console.log(`❌ Missing projects: ${missingProjects.length}\n`);
  
  if (missingProjects.length > 0) {
    console.log('📋 Missing projects:\n');
    missingProjects.forEach(page => {
      console.log(`  - ${page.name} (Notion ID: ${page.id})`);
      const parentIds = page.parent_ids || (page.parent_id ? [page.parent_id] : []);
      if (parentIds.length > 0) {
        console.log(`    Parents: ${parentIds.length} parent(s)`);
      } else {
        console.log(`    Root level (no parents)`);
      }
      console.log('');
    });
  } else {
    console.log('✅ All projects are imported!\n');
  }
  
  // Also check for projects with (Area) in name
  const areaProjects = notionPages.filter(p => 
    (p.name.includes('(Area)') || p.name.includes('Area')) && !p.archived
  );
  
  console.log(`\n🏢 Projects with "Area" in Notion: ${areaProjects.length}`);
  areaProjects.forEach(p => {
    const exists = existingNotionIds.has(p.id);
    console.log(`  ${exists ? '✅' : '❌'} ${p.name}${exists ? '' : ' (MISSING)'}`);
  });
}

checkMissingProjects()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });

